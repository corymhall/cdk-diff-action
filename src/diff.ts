import {
  ResourceDifference,
  ResourceImpact,
  TemplateDiff,
} from '@aws-cdk/cloudformation-diff';

export interface StackDiffInfo {
  /**
   * The name of the stack
   */
  stackName: string;

  /**
   * The template diff for the stack
   */
  diff: TemplateDiff;
}

export interface StageDiffInfo {
  /**
   * The name of the stage
   */
  name: string;

  /**
   * The stacks within the stage
   */
  stacks: StackDiffInfo[];
}

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
  constructor(
    private readonly stack: StackDiffInfo,
    private readonly allowedDestroyTypes: string[],
  ) {}

  /** Performs the diff on the CloudFormation stack
   * This reads the existing stack from CFN and then uses the cloudformation-diff
   * package to perform the diff and collect additional information on the type of changes
   */
  public async diffStack(): Promise<{
    diff: TemplateDiff;
    changes: ChangeDetails;
  }> {
    const changes = this.evaluateDiff(this.stack.stackName, this.stack.diff);
    return {
      diff: this.stack.diff,
      changes,
    };
  }

  private evaluateDiff(
    templateId: string,
    templateDiff: TemplateDiff,
  ): ChangeDetails {
    const changes: ChangeDetails = {
      createdResources: 0,
      removedResources: 0,
      updatedResources: 0,
      destructiveChanges: [],
    };
    // go through all the resource differences and check for any
    // "destructive" changes
    templateDiff.resources.forEachDifference(
      (logicalId: string, change: ResourceDifference) => {
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
              (keys.length <= 2 && keys.includes('Code')) ||
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
      },
    );
    return changes;
  }
}
