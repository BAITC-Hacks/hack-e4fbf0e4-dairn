from uuid import uuid4


class DomainError(Exception):
    def __init__(self, status: int, code: str, message: str, retryable: bool = False):
        self.status, self.code, self.message, self.retryable = status, code, message, retryable
        super().__init__(message)

    def body(self):
        return {'code': self.code, 'message': self.message, 'retryable': self.retryable, 'request_id': uuid4().hex}
