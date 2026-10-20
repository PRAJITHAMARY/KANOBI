import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  PROJECT_CREATED,
  PROJECT_DELETED,
  projectCreatedHandler,
  projectDeletedHandler,
} from "../api/project/projectEvent";
import { ApplicationEvent } from "../types";
import {
  MODEL_CREATED,
  MODEL_DELETED,
  MODEL_UPDATED,
  modelCreatedHandler,
  modelDeletedHandler,
  modelUpdatedHandler,
} from "../api/model/modelEvent";
import {
  DEPLOYMENT_TRIGGERED,
  deploymentTriggeredHandler,
} from "../api/deployment/deploymentEvent";

export interface IEventHub {
  publish<TPayload>(payload: ApplicationEvent<TPayload>): Promise<boolean>;
}

export class LocalEventHub implements IEventHub {
  private events: {
    [key: string]: { handler: (payload: any) => Promise<any> };
  };
  constructor() {
    this.events = {
      "": {
        handler: (test) => Promise.resolve(test),
      },
    };

    this.events[PROJECT_CREATED] = {
      handler: projectCreatedHandler,
    };
    this.events[PROJECT_DELETED] = {
      handler: projectDeletedHandler,
    };
    this.events[MODEL_CREATED] = {
      handler: modelCreatedHandler,
    };
    this.events[MODEL_DELETED] = {
      handler: modelDeletedHandler,
    };
    this.events[MODEL_UPDATED] = {
      handler: modelUpdatedHandler,
    };
    this.events[DEPLOYMENT_TRIGGERED] = {
      handler: deploymentTriggeredHandler,
    };
  }

  async publish<TPayload, TResponse>(
    payload: ApplicationEvent<TPayload>
  ): Promise<TResponse> {
    return new Promise<TResponse>(async (resolve, reject) => {
      try {
        const event = this.events[payload.type];
        if (!event) {
          reject(payload.type + " Event handler not found");
        }

        const response = await event.handler(payload.payload);
        resolve(response);
      } catch (error) {
        reject(payload.type + " " + error);
      }
    });
  }
}

export class LambdaEventHub implements IEventHub {
  private events: {
    [key: string]: { functionName: string };
  };
  constructor() {
    this.events = {
      "": {
        functionName: `test-function-name`,
      },
    };

    this.events[PROJECT_CREATED] = {
      functionName: `project-kanobi-${process.env.STAGE_NAME}-${projectCreatedHandler.name}`,
    };
    this.events[PROJECT_DELETED] = {
      functionName: `project-kanobi-${process.env.STAGE_NAME}-${projectDeletedHandler.name}`,
    };
    this.events[MODEL_CREATED] = {
      functionName: `project-kanobi-${process.env.STAGE_NAME}-${modelCreatedHandler.name}`,
    };
    this.events[MODEL_DELETED] = {
      functionName: `project-kanobi-${process.env.STAGE_NAME}-${modelDeletedHandler.name}`,
    };
    this.events[MODEL_UPDATED] = {
      functionName: `project-kanobi-${process.env.STAGE_NAME}-${modelUpdatedHandler.name}`,
    };
    this.events[DEPLOYMENT_TRIGGERED] = {
      functionName: `project-kanobi-${process.env.STAGE_NAME}-${deploymentTriggeredHandler.name}`,
    };
  }

  async publish<TPayload>(
    payload: ApplicationEvent<TPayload>
  ): Promise<boolean> {
    const event = this.events[payload.type];
    if (!event) {
      throw payload.type + " Event handler not found";
    }

    // No explicit credentials: the Lambda execution role is used.
    const lambda = new LambdaClient({ region: process.env.AWS_DEPLOY_REGION });
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: event.functionName,
        Payload: new TextEncoder().encode(JSON.stringify(payload.payload)),
        InvocationType: "Event",
      })
    );
    return (
      response.FunctionError == null || response.FunctionError == undefined
    );
  }
}

export class EventHub {
  static Get(): IEventHub {
    let eventHub: IEventHub = new LambdaEventHub();
    if (process.env.NODE_ENV == "dev") eventHub = new LocalEventHub();
    return eventHub;
  }
}
