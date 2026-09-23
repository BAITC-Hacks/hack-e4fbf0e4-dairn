package kz.hackalem.catalog.cli

import java.io.IOException
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.LinkOption
import java.nio.file.Path
import kz.hackalem.catalog.ekt.*
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    exitProcess(EktCli().run(args))
}

/** The CLI owns argument parsing and local export; HTTP and JSON validation stay in EktRawClient. */
internal class EktCli(
    private val environment: () -> Map<String, String> = System::getenv,
    private val transport: () -> EktTransport = { JdkEktTransport() },
    private val stdout: PrintStream = System.out,
    private val stderr: PrintStream = System.err,
) {
    fun run(args: Array<String>): Int {
        var operation = "arguments"
        var status: Int? = null
        return try {
            val command = parse(args)
            if (command == null) {
                stdout.print(HELP)
                return if (stdout.checkError()) 4 else 0
            }
            operation = command.operation
            // Fail before making a request if the target already exists (including a dangling symlink).
            command.output?.let {
                if (Files.exists(it, LinkOption.NOFOLLOW_LINKS)) throw FileAlreadyExistsException("")
            }
            val client = EktRawClient(EktConfig.fromEnvironment(environment()), transport())
            val response = when (command.operation) {
                "list" -> client.listResponse(command.page)
                else -> client.detailResponse(command.id!!)
            }
            status = response.status
            if (command.output != null) {
                exportJson(command.output, response.text)
            } else {
                stdout.print(response.text)
                stdout.println()
                if (stdout.checkError()) throw IOException()
            }
            stderr.println("$operation: success (HTTP $status); JSON ${if (command.output == null) "written to stdout" else "exported"}")
            0
        } catch (error: ArgumentError) {
            stderr.println("$operation: ${error.message}. Use --help.")
            2
        } catch (error: EktException.Configuration) {
            stderr.println("$operation: configuration error: ${error.message}")
            2
        } catch (error: EktException) {
            val failure = when (error) {
                is EktException.Authentication -> "authentication failed (HTTP ${error.status})"
                is EktException.NotFound -> "resource not found (HTTP 404)"
                is EktException.Http -> "upstream request failed (HTTP ${error.status})"
                is EktException.Timeout -> "request timed out"
                is EktException.Interrupted -> "request interrupted"
                is EktException.InvalidResponse -> "invalid JSON response or response limit exceeded" +
                    (error.status?.let { " (HTTP $it)" } ?: "")
                is EktException.InvalidRequest -> "invalid request; use --help"
                else -> "upstream unavailable"
            }
            stderr.println("$operation: failure: $failure")
            3
        } catch (_: FileAlreadyExistsException) {
            stderr.println("$operation: export refused${status?.let { " after HTTP $it" } ?: ""}: output already exists or a parent is not a directory; choose a new path")
            4
        } catch (_: IOException) {
            stderr.println("$operation: output failure${status?.let { " after HTTP $it" } ?: ""}; check directory access, disk space and output stream")
            4
        } catch (_: UnsupportedOperationException) {
            stderr.println("$operation: export failed; filesystem must support hard links for safe publication")
            4
        } catch (_: SecurityException) {
            stderr.println("$operation: access denied; check environment and output permissions")
            4
        } catch (_: Exception) {
            // Never print arbitrary exception messages, input values, URLs or upstream bodies.
            stderr.println("$operation: unexpected failure")
            1
        }
    }
}

private class ArgumentError(message: String) : RuntimeException(message)
private data class Command(val operation: String, val page: Int?, val id: String?, val output: Path?)

private fun parse(args: Array<String>): Command? {
    if (args.contentEquals(arrayOf("--help"))) return null
    val operation = args.firstOrNull() ?: throw ArgumentError("Expected list or detail")
    if (operation !in setOf("list", "detail")) throw ArgumentError("Unknown command; expected list or detail")
    val allowed = if (operation == "list") setOf("--page", "--output") else setOf("--id", "--output")
    val options = mutableMapOf<String, String>()
    var index = 1
    while (index < args.size) {
        val option = args[index++]
        if (option !in allowed) throw ArgumentError("Unknown option for $operation")
        if (option in options) throw ArgumentError("Duplicate $option option")
        val value = args.getOrNull(index++)?.takeUnless { it.startsWith("--") || it.isBlank() }
            ?: throw ArgumentError("Missing value for $option")
        options[option] = value
    }
    val page = options["--page"]?.let {
        it.toIntOrNull()?.takeIf { value -> value > 0 }
            ?: throw ArgumentError("--page must be a positive integer")
    }
    val id = options["--id"]
    if (operation == "detail" && id == null) throw ArgumentError("detail requires --id")
    if (id?.any { it.isISOControl() } == true) throw ArgumentError("--id must not contain control characters")
    val output = options["--output"]?.let {
        if (it.any { char -> char.isISOControl() }) throw ArgumentError("Invalid --output path")
        try { Path.of(it) } catch (_: InvalidPathException) { throw ArgumentError("Invalid --output path") }
    }
    return Command(operation, page, id, output)
}

/** Publish a fully written sibling file with atomic create-if-absent semantics, including races. */
internal fun exportJson(output: Path, json: String) {
    val target = output.toAbsolutePath()
    val parent = target.parent
    Files.createDirectories(parent)
    val temporary = Files.createTempFile(parent, ".ekt-export-", ".tmp")
    try {
        Files.writeString(temporary, json + "\n", StandardCharsets.UTF_8)
        // move(ATOMIC_MOVE) may overwrite a racing target; hard-link creation cannot.
        Files.createLink(target, temporary)
    } finally {
        Files.deleteIfExists(temporary)
    }
}

private val HELP = """
EKT catalog investigation CLI (raw JSON; no HTTP server)

Usage:
  --help
  list [--page POSITIVE_INTEGER] [--output PATH]
  detail --id PRODUCT_ID [--output PATH]

Environment: EKT_API_BASE_URL, EKT_API_USERNAME, EKT_API_PASSWORD.
Credentials are read only from the process environment; .env is not loaded.
Without --output, JSON goes to stdout; diagnostics go to stderr.
Relative paths use the process working directory (repository root for Gradle run).
Existing output files are never replaced. Export requires a filesystem with hard links.
Local evidence: catalog-service/local-evidence/ (ignored by Git).
Exit codes: 0 success, 2 arguments/configuration, 3 upstream/network/JSON,
            4 output/access failure, 1 unexpected failure.
""".trimIndent() + "\n"
