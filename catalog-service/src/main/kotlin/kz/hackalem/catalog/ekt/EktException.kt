package kz.hackalem.catalog.ekt

/** Messages never include credentials, request URLs or untrusted upstream response bodies. */
sealed class EktException(message: String) : RuntimeException(message) {
    class Configuration(message: String) : EktException(message)
    class InvalidRequest(message: String = "Invalid EKT request") : EktException(message)
    class Authentication(val status: Int) : EktException("EKT authentication failed (HTTP $status)")
    class NotFound : EktException("EKT resource not found (HTTP 404)")
    class Http(val status: Int) : EktException("EKT request failed (HTTP $status)")
    class Unavailable : EktException("EKT API is unavailable")
    class Timeout : EktException("EKT request timed out")
    class Interrupted : EktException("EKT request was interrupted")
    class InvalidResponse : EktException("EKT returned an invalid or oversized JSON response")
}
