import { ZodError } from "zod";
import { logError } from "./logger";

export class ResponseManager {
  static OkResponse<T>(data: T, meta = {}, message = "ok") {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
      body: JSON.stringify({
        data: data,
        message: message,
        meta: meta,
      }),
    };
  }

  static CreatedResponse<T>(data: T, meta = {}, message = "created") {
    return {
      statusCode: 201,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
      body: JSON.stringify({
        data: data,
        message: message,
        meta: meta,
      }),
    };
  }

  static NoContentResponse() {
    return {
      statusCode: 204,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
    };
  }

  static NotfoundResponse(message = "Not found") {
    return {
      statusCode: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
      body: JSON.stringify({
        message: message,
      }),
    };
  }

  static AuthFailedResponse(message = "Auth failed") {
    return {
      statusCode: 401,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
      body: JSON.stringify({
        message: message,
      }),
    };
  }

  static BadRequestResponse(data: any, message = "Bad request") {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
      body: JSON.stringify({
        data,
        message: message,
      }),
    };
  }

  /** 400 with the zod issues as data and the first issue as a readable message. */
  static ValidationErrorResponse(error: ZodError) {
    const [issue] = error.errors;
    if (!issue) return ResponseManager.BadRequestResponse(error.errors);
    const path = issue.path.join(".");
    return ResponseManager.BadRequestResponse(
      error.errors,
      path ? `${path}: ${issue.message}` : issue.message
    );
  }

  static InternalErrorResponse(
    functionName: string,
    error: any,
    message = "An unexpected error occured!"
  ) {
    logError(functionName, error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
      },
      body: JSON.stringify({
        message: message,
      }),
    };
  }
}
