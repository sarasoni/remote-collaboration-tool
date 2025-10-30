class ApiError extends Error{
    constructor(statusCode,message="something went wrong",errors=[],stack="") {
        super(message);
        this.success = false;
        this.statusCode = statusCode;
        this.message = message;
        this.errors = errors;
        this.data = null;

        if (stack) {
            this.stack = stack;
        } else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export { ApiError };