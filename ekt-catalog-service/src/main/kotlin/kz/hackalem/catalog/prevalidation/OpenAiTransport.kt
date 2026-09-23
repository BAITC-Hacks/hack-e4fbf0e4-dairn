package kz.hackalem.catalog.prevalidation

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.http.*
import java.nio.ByteBuffer
import java.time.Duration
import java.util.concurrent.*

internal fun interface OpenAiTransport { fun send(request: HttpRequest): OpenAiResponse }
internal class OpenAiResponse(val status: Int, val body: ByteArray) {
    override fun toString() = "OpenAiResponse(status=$status, body=[redacted])"
}

internal class JdkOpenAiTransport : OpenAiTransport {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER).build()

    override fun send(request: HttpRequest): OpenAiResponse {
        val pending = client.sendAsync(request) { info ->
            if (info.statusCode() in 200..299) BoundedAiBody(MAX_RESPONSE_BYTES)
            else HttpResponse.BodySubscribers.replacing(ByteArray(0))
        }
        return try {
            // JDK request timeout alone may stop at headers. Bound the entire body reception too.
            val response = pending.get(request.timeout().orElse(Duration.ofSeconds(30)).toMillis(), TimeUnit.MILLISECONDS)
            OpenAiResponse(response.statusCode(), response.body())
        } catch (_: TimeoutException) {
            pending.cancel(true)
            fail(FailureCategory.timeout)
        } catch (_: InterruptedException) {
            pending.cancel(true)
            Thread.currentThread().interrupt()
            fail(FailureCategory.interrupted)
        } catch (error: ExecutionException) {
            val causes = generateSequence<Throwable>(error) { it.cause }.toList()
            if (causes.any { it is HttpTimeoutException }) fail(FailureCategory.timeout)
            if (causes.any { it is AiBodyTooLarge }) fail(FailureCategory.response_too_large)
            fail(FailureCategory.transport)
        }
    }

    companion object { const val MAX_RESPONSE_BYTES = 256 * 1024 }
}

private class AiBodyTooLarge : IOException("AI response exceeded limit")
internal class BoundedAiBody(private val limit: Int) : HttpResponse.BodySubscriber<ByteArray> {
    private val result = CompletableFuture<ByteArray>()
    private val bytes = ByteArrayOutputStream()
    private lateinit var subscription: Flow.Subscription
    override fun getBody(): CompletionStage<ByteArray> = result
    override fun onSubscribe(subscription: Flow.Subscription) { this.subscription = subscription; subscription.request(1) }
    override fun onNext(items: List<ByteBuffer>) {
        for (item in items) {
            if (item.remaining() > limit - bytes.size()) {
                subscription.cancel()
                result.completeExceptionally(AiBodyTooLarge())
                return
            }
            val chunk = ByteArray(item.remaining())
            item.get(chunk)
            bytes.write(chunk)
        }
        subscription.request(1)
    }
    override fun onError(error: Throwable) { result.completeExceptionally(error) }
    override fun onComplete() { result.complete(bytes.toByteArray()) }
}
