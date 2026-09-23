package kz.hackalem.catalog.ekt

import java.io.IOException
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.Flow
import java.nio.ByteBuffer

internal fun interface EktTransport {
    fun send(request: HttpRequest): TransportResponse
}

internal class TransportResponse(val status: Int, val contentType: String?, val body: ByteArray) {
    override fun toString(): String = "TransportResponse(status=$status, body=[redacted])"
}

/** No redirects: Authorization must never be forwarded to another origin. */
internal class JdkEktTransport : EktTransport {
    private val client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build()

    override fun send(request: HttpRequest): TransportResponse = try {
        val response = client.send(request) { info ->
            // Error pages can contain sensitive content; discard them without retaining the body.
            if (info.statusCode() in 200..299) LimitedBodySubscriber(MAX_RESPONSE_BYTES)
            else HttpResponse.BodySubscribers.replacing(ByteArray(0))
        }
        TransportResponse(response.statusCode(), response.headers().firstValue("Content-Type").orElse(null), response.body())
    } catch (_: HttpTimeoutException) {
        throw EktException.Timeout()
    } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        throw EktException.Interrupted()
    } catch (error: IOException) {
        if (generateSequence<Throwable>(error) { it.cause }.any { it is ResponseTooLarge }) {
            throw EktException.InvalidResponse()
        }
        throw EktException.Unavailable()
    }

    companion object { internal const val MAX_RESPONSE_BYTES = 8 * 1024 * 1024 }
}

internal class ResponseTooLarge : IOException("EKT response exceeded size limit")

/** Bounds memory while receiving data; the HTTP request timeout also covers body reception. */
internal class LimitedBodySubscriber(private val limit: Int) : HttpResponse.BodySubscriber<ByteArray> {
    private val result = CompletableFuture<ByteArray>()
    private val bytes = java.io.ByteArrayOutputStream()
    private lateinit var subscription: Flow.Subscription

    override fun getBody(): CompletionStage<ByteArray> = result
    override fun onSubscribe(subscription: Flow.Subscription) {
        this.subscription = subscription
        subscription.request(1)
    }
    override fun onNext(items: List<ByteBuffer>) {
        for (item in items) {
            if (item.remaining() > limit - bytes.size()) {
                subscription.cancel()
                result.completeExceptionally(ResponseTooLarge())
                return
            }
            val chunk = ByteArray(item.remaining())
            item.get(chunk)
            bytes.write(chunk)
        }
        subscription.request(1)
    }
    override fun onError(throwable: Throwable) { result.completeExceptionally(throwable) }
    override fun onComplete() { result.complete(bytes.toByteArray()) }
}
