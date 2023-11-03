import * as crypto from 'crypto';
import { Writable, WritableOptions } from 'stream';
import { StringDecoder } from 'string_decoder';
import { TemplateDiff, formatDifferences } from '@aws-cdk/cloudformation-diff';
import { StackInfo, StageInfo } from './assembly';
import { Comments } from './comment';
import { ChangeDetails, StackDiff } from './diff';

/**
 * Information needed to make a comment for a CDK Stage
 */
interface StageComment {
  /**
   * The full comment. The list will be joined with \n
   */
  comment: string[];

  /**
   * The unique hash for the stage comment
   * This will be used to lookup the stage comment on the PR
   * so that it can be overwritten
   */
  hash: string;

  /**
   * The number of destructive changes in this stage
   */
  destructiveChanges: number;
}

/**
 * StageProcessor processes a CDK stage and creates a comment on the GitHub PR
 * detailing the stack diffs
 */
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
        hash: md5Hash(JSON.stringify({
          stageName: stage.name,
          ...stage.stacks.reduce((prev, curr) => {
            prev.stacks.push({
              name: curr.name,
              lookupRole: curr.lookupRole,
              region: curr.region,
            });
            return prev;
          }, { stacks: [] } as { stacks: Omit<StackInfo, 'content'>[] }), // we don't want the content to be part of the hash
        })),
      };
    });
  }

  /**
   * Process all of the stages. Once this has been run
   * the comment can be created with `commentStages()`
   */
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

  /**
   * Create the GitHub comment for the stage
   */
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

  /**
   * Returns whether or not there are destructive changes in this stage
   */
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
      const { diff, changes } = await stackDiff.diffStack();
      return {
        comment: this.formatStackComment(stack.name, diff, changes),
        changes: changes.destructiveChanges.length,
      };

    } catch (e: any) {
      console.error('Error performing stack diff: ', e);
      throw e;
    }
  }

  private getEmoji(changes: ChangeDetails): string {
    if (changes.destructiveChanges.length || changes.removedResources) {
      return ':x:';
    } else if (changes.updatedResources) {
      return ':yellow_circle:';
    } else if (changes.createdResources) {
      return ':sparkle:';
    }
    return ':white_check_mark:';
  }

  private formatStackComment(stackName: string, diff: TemplateDiff, changes: ChangeDetails): string[] {
    const output: string[] = [];
    const emoji = this.getEmoji(changes);
    if (diff.isEmpty) {
      output.push(`No Changes for stack: ${stackName}`);
      return output;
    }
    output.push(...[
      `#### Diff for stack: ${stackName} - `+
        `***${changes.createdResources} to add, ${changes.updatedResources} to update, ${changes.removedResources} to destroy***  `+
        emoji,
      '<details><summary>Details</summary>',
      '',
    ]);
    if (changes.destructiveChanges.length) {
      output.push('> [!WARNING]\n> ***Destructive Changes*** :bangbang:'),
      changes.destructiveChanges.forEach(change => {
        output.push(
          `> **Stack: ${change.stackName} - Resource: ${change.logicalId} - Impact:** ***${change.impact}***`,
        );
      });
    }
    const writable = new StringWritable({});
    formatDifferences(writable, diff);

    output.push('```shell');
    output.push(writable.data);
    output.push('```');
    output.push('</details>');
    output.push('');
    return output;
  }


  private getCommentForStage(stageName: string): string[] {
    const output: string[] = [];
    const stageComments = this.stageComments[stageName];
    if (!stageComments.comment.length) {
      return output;
    }
    output.push(`### Diff for stage: ${stageName}`);

    if (stageComments.destructiveChanges) {
      output.push(`> [!WARNING]\n> ${stageComments.destructiveChanges} Destructive Changes`);
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

function md5Hash(val: string): string {
  return crypto.createHash('md5').update(val).digest('hex');
};
