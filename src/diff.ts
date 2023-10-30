import * as crypto from 'crypto';
import { Writable, WritableOptions } from 'stream';
import { StringDecoder } from 'string_decoder';
import { ResourceDifference, ResourceImpact, TemplateDiff, diffTemplate, formatDifferences } from '@aws-cdk/cloudformation-diff';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentityProvider } from '@smithy/types';
import chalk from 'chalk';
import { StackInfo, StageInfo } from './assembly';
import { Comments } from './comment';

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

export class StackDiff {
  private readonly client: CloudFormationClient;
  constructor(
    private readonly stack: StackInfo,
    private readonly allowedDestroyTypes: string[],
  ) {
    let credentials: AwsCredentialIdentityProvider | undefined;
    credentials = stack.lookupRole ? fromTemporaryCredentials({
      params: {
        RoleArn: stack.lookupRole.arn.replace('${AWS::Partition}', 'aws'),
        RoleSessionName: 'cdk-diff-action',
        ExternalId: stack.lookupRole.assumeRoleExternalId,
        DurationSeconds: 900,
      },
    }) : undefined;
    this.client = new CloudFormationClient({
      credentials,
    });

  }

  public async diffStack(): Promise<{ diff: TemplateDiff; destructiveChanges: DestructiveChange[] }> {
    const cmd = new GetTemplateCommand({
      StackName: this.stack.name,
    });
    try {
      const res = await this.client.send(cmd);
      const newTemplate = res.TemplateBody ?
        JSON.parse(res.TemplateBody) : {};
      const diff = diffTemplate(newTemplate, JSON.parse(this.stack.content));
      const changes = this.evaluateDiff(this.stack.name, diff);
      return {
        diff,
        destructiveChanges: changes,
      };

    } catch (e: any) {
      console.error('Error getting remote template: ', e);
      throw e;
    }
  }

  private evaluateDiff(templateId: string, templateDiff: TemplateDiff): DestructiveChange[] {
    const destructiveChanges: DestructiveChange[] = [];
    // go through all the resource differences and check for any
    // "destructive" changes
    templateDiff.resources.forEachDifference((logicalId: string, change: ResourceDifference) => {
    // if the change is a removal it will not show up as a 'changeImpact'
    // so need to check for it separately, unless it is a resourceType that
    // has been "allowed" to be destroyed
      const resourceType = change.oldValue?.Type ?? change.newValue?.Type;
      if (resourceType && this.allowedDestroyTypes.includes(resourceType)) {
        return;
      }
      if (change.isRemoval) {
        destructiveChanges.push({
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
            destructiveChanges.push({
              impact: change.changeImpact,
              logicalId,
              stackName: templateId,
            });
            break;
        }
      }
    });
    return destructiveChanges;
  }
}

interface StageComment {
  comment: string[];
  hash: string;
  destructiveChanges: number;
}


function md5Hash(val: string): string {
  return crypto.createHash('md5').update(val).digest('hex');
};
export class StageProcessor {
  private readonly stageComments: { [stageName: string]: StageComment } = {};
  constructor(
    private readonly stages: StageInfo[],
    private readonly allowedDestroyTypes: string[],
  ) {
    this.stages.forEach(stage => {
      this.stageComments[stage.name] = {
        destructiveChanges: 0,
        comment: [],
        hash: md5Hash(JSON.stringify(stage)),
      };
    });
  }

  public async processStages() {
    for (const stage of this.stages) {
      for (const stack of stage.stacks) {
        try {
          const { comment, changes } = await this.diffStack(stack);
          this.stageComments[stage.name].comment.push(...comment);
          this.stageComments[stage.name].destructiveChanges += changes;
        } catch (e: any) {
          console.error('Error processing stages: ', e);
          throw e;
        }
      }
    }
  }

  public get hasDestructiveChanges(): boolean {
    for (const comments of Object.values(this.stageComments)) {
      if (comments.destructiveChanges) {
        return true;
      }
    }
    return false;
  }

  private async diffStack(stack: StackInfo): Promise<{comment: string[]; changes: number}> {
    try {
      const stackDiff = new StackDiff(stack, this.allowedDestroyTypes);
      const { diff, destructiveChanges } = await stackDiff.diffStack();
      return {
        comment: this.formatStackComment(stack.name, diff, destructiveChanges),
        changes: destructiveChanges.length,
      };

    } catch (e: any) {
      console.error('Error performing stack diff: ', e);
      throw e;
    }
  }

  private formatStackComment(stackName: string, diff: TemplateDiff, changes: DestructiveChange[]): string[] {
    const output: string[] = [];
    if (diff.isEmpty) {
      return output;
    }
    output.push(`\n<details><summary>Diff for stack: ${stackName}</summary>\n`);
    if (changes.length) {
      output.push(`${chalk.red('\n\n!!!Destructive Changes!!!\n')}`),
      output.push('```shell\n');
      changes.forEach(change => {
        output.push(
          chalk.yellow(`Stack: ${change.stackName} - Resource: ${change.logicalId} - Impact: ${change.impact}\n`),
        );
      });
      output.push('```');
      output.push('\n\n');
    }
    const writable = new StringWritable({});
    formatDifferences(writable, diff);

    output.push('```shell\n');
    output.push(writable.data);
    output.push('\n```\n');
    output.push('</details>\n');
    return output;
  }

  public async commentStages(comments: Comments) {
    for (const [stageName, info] of Object.entries(this.stageComments)) {
      const stageComment = this.getCommentForStage(stageName);
      const previous = await comments.findPrevious(info.hash);
      if (previous) {
        await comments.updateComment(previous, info.hash, stageComment);
      } else {
        await comments.createComment(info.hash, stageComment);
      }
    }
  }

  private getCommentForStage(stageName: string): string[] {
    const output: string[] = [];
    const stageComments = this.stageComments[stageName];
    if (!stageComments.comment.length) {
      return output;
    }
    output.push(`### Diff for stage: ${stageName}\n`);

    if (stageComments.destructiveChanges) {
      output.push(`${chalk.red(`\n\n!!!Destructive Changes: ${chalk.bold(stageComments.destructiveChanges)}!!!\n`)}`);
    }
    return output.concat(stageComments.comment);
  }
}

class StringWritable extends Writable {
  public data: string;
  private _decoder: StringDecoder;
  constructor(options: WritableOptions) {
    super(options);
    this._decoder = new StringDecoder();
    this.data = '';
  }

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    if (encoding === 'buffer') {
      chunk = this._decoder.write(chunk);
    }

    this.data += chunk;
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    this.data += this._decoder.end();
    callback();
  }
}
