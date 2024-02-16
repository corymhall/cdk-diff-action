import { ResourceDifference, ResourceImpact, TemplateDiff, fullDiff } from '@aws-cdk/cloudformation-diff';
import { CloudFormationClient, GetTemplateCommand, StackNotFoundException } from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentityProvider } from '@smithy/types';
import { StackInfo } from './assembly';

/**
 * Details on what changes are occurring in this stack
 */
export interface ChangeDetails {
  /**
   * The number of resources that are being updated
   */
  updatedResources: number;

  /**
   * The number of resources that are being removed
   */
  removedResources: number;

  /**
   * The number of resources that are being created
   */
  createdResources: number;

  /**
   * Information on any destructive changes
   */
  destructiveChanges: DestructiveChange[];

  /**
   * Whether this stack has an unknown env. If that is the case
   * then this returns the environment credentials that are being used
   * in the format aws://<account>/<region>
   *
   * @default - account is known
   */
  unknownEnvironment?: string;
}

/**
 * Information on any destructive changes
 */
export interface DestructiveChange {
  /**
   * The logicalId of the resource with a destructive change
   */
  readonly logicalId: string;

  /**
   * The name of the stack that contains the destructive change
   */
  readonly stackName: string;

  /**
   * The impact of the destructive change
   */
  readonly impact: ResourceImpact;
}

/**
 * StackDiff performs the diff on a stack
 */
export class StackDiff {
  private readonly client: CloudFormationClient;
  private readonly credentials: AwsCredentialIdentityProvider | undefined;
  constructor(
    private readonly stack: StackInfo,
    private readonly allowedDestroyTypes: string[],
  ) {
    let credentials: AwsCredentialIdentityProvider | undefined;
    // if there is a lookup role then assume that, otherwise
    // just use the default credentials
    credentials = stack.lookupRole ? fromTemporaryCredentials({
      params: {
        RoleArn: stack.lookupRole.arn.replace('${AWS::Partition}', 'aws'),
        RoleSessionName: 'cdk-diff-action',
        ExternalId: stack.lookupRole.assumeRoleExternalId,
        DurationSeconds: 900,
      },
    }) : undefined;
    this.credentials = credentials;
    this.client = new CloudFormationClient({
      credentials,
      region: this.stack.region,
    });
  }

  /**
   * Validates the environment of the stack and whether it matches
   * the credentials being used by the GitHub action
   *
   * There are two cases that we care about:
   * 1. The stack has an account and region defined _and_ the credentials
   *   being used by the GitHub action are for a different account and region.
   *   In this case we throw an error because the stack diff would not be correct
   * 2. The stack has an account and region that are _not_ defined. In this case
   *    We will return true to indicate that the environment is unknown. This will be used
   *    later to print a warning in the stack diff.
   *
   * @returns whether or not the environment is unknown
   */
  private async validateEnvironment(): Promise<string | undefined> {
    let unknownAccount = false;
    let unknownRegion = false;
    const stsClient = new STSClient({
      credentials: this.credentials,
    });
    const callerIdentity = new GetCallerIdentityCommand({ });
    const identity = await stsClient.send(callerIdentity);
    const configRegion = await this.client.config.region();
    if (!this.stack.region) {
      unknownRegion = true;
    }
    if (!this.stack.account) {
      unknownAccount = true;
    }
    if (this.stack.account && identity.Account !== this.stack.account) {
      throw new Error(`Credentials are for account ${identity.Account} but stack is in account ${this.stack.account}`);
    }

    if (this.stack.region && configRegion !== this.stack.region) {
      throw new Error(`Credentials are for region ${configRegion} but stack is in region ${this.stack.region}`);
    }

    if (unknownAccount || unknownRegion) {
      return `aws://${identity.Account}/${configRegion}`;
    }

    return;
  }

  /** Performs the diff on the CloudFormation stack
   * This reads the existing stack from CFN and then uses the cloudformation-diff
   * package to perform the diff and collect additional information on the type of changes
   */
  public async diffStack(): Promise<{ diff: TemplateDiff; changes: ChangeDetails }> {
    const unknownEnv = await this.validateEnvironment();

    const cmd = new GetTemplateCommand({
      StackName: this.stack.name,
    });
    let existingTemplate: { [key: string]: any } = {};
    try {
      const res = await this.client.send(cmd);
      existingTemplate = res.TemplateBody ? JSON.parse(res.TemplateBody) : {};
    } catch (e: any) {
      if (e instanceof StackNotFoundException) {
        existingTemplate = {};
      }
    }
    try {
      const diff = fullDiff(existingTemplate, this.stack.content);
      const changes = this.evaluateDiff(this.stack.name, diff);
      changes.unknownEnvironment = unknownEnv;
      return {
        diff,
        changes,
      };

    } catch (e: any) {
      console.error('Error getting remote template: ', e);
      throw e;
    }
  }

  private evaluateDiff(templateId: string, templateDiff: TemplateDiff): ChangeDetails {
    const changes: ChangeDetails = {
      createdResources: 0,
      removedResources: 0,
      updatedResources: 0,
      destructiveChanges: [],
    };
    // go through all the resource differences and check for any
    // "destructive" changes
    templateDiff.resources.forEachDifference((logicalId: string, change: ResourceDifference) => {
      // if the change is a removal it will not show up as a 'changeImpact'
      // so need to check for it separately, unless it is a resourceType that
      // has been "allowed" to be destroyed
      const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
      switch (resourceType) {
        case 'AWS::CDK::Metadata':
          return;
        case 'AWS::Lambda::Function':
          const keys = Object.keys(change.propertyUpdates);
          if (
            keys.length <= 2 &&
            keys.includes('Code') ||
            keys.includes('Metadata')
          ) {
            return;
          }
      }
      if (change.isUpdate) {
        changes.updatedResources += 1;
      } else if (change.isRemoval) {
        changes.removedResources += 1;
      } else if (change.isAddition) {
        changes.createdResources += 1;
      }
      if (resourceType && this.allowedDestroyTypes.includes(resourceType)) {
        return;
      }

      if (change.isRemoval) {
        changes.destructiveChanges.push({
          impact: ResourceImpact.WILL_DESTROY,
          logicalId,
          stackName: templateId,
        });
      } else {
        switch (change.changeImpact) {
          case ResourceImpact.MAY_REPLACE:
          case ResourceImpact.WILL_ORPHAN:
          case ResourceImpact.WILL_DESTROY:
          case ResourceImpact.WILL_REPLACE:
            changes.destructiveChanges.push({
              impact: change.changeImpact,
              logicalId,
              stackName: templateId,
            });
            break;
        }
      }
    });
    return changes;
  }
}
