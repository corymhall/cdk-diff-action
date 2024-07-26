import * as crypto from 'crypto';
import { Writable, WritableOptions } from 'stream';
import { StringDecoder } from 'string_decoder';
import { TemplateDiff, formatDifferences } from '@aws-cdk/cloudformation-diff';
import { StackInfo, StageInfo } from './assembly';
import { Comments } from './comment';
import { ChangeDetails, StackDiff } from './diff';

// the max comment length allowed by GitHub
const MAX_COMMENT_LENGTH = 65536;

/**
 * Information needed to make a comment for a CDK Stage
 */
interface StageComment {
  /**
   * The full comment for each stack. The list will be joined with \n
   */
  stackComments: { [stackName: string]: string[] };

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

  /**
   * The number of all changes in this stage
   */
  totalChanges: number;
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
        totalChanges: 0,
        destructiveChanges: 0,
        stackComments: stage.stacks.reduce((prev, curr) => {
          prev[curr.name] = [];
          return prev;
        }, {} as { [stackName: string]: string[] }),
        hash: md5Hash(JSON.stringify({
          stageName: stage.name,
          ...stage.stacks.reduce((prev, curr) => {
            prev.stacks.push({
              name: curr.name,
              lookupRole: curr.lookupRole,
              account: curr.account,
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
  public async processStages(ignoreDestructiveChanges: string[] = []) {
    for (const stage of this.stages) {
      for (const stack of stage.stacks) {
        try {
          const { comment, changes } = await this.diffStack(stack);
          this.stageComments[stage.name].stackComments[stack.name].push(...comment);
          this.stageComments[stage.name].totalChanges += changes;
          if (!ignoreDestructiveChanges.includes(stage.name)) {
            this.stageComments[stage.name].destructiveChanges += changes;
          }
        } catch (e: any) {
          console.error('Error processing stages: ', e);
          throw e;
        }
      }
    }
  }

  private async commentStacks(comments: Comments, totalChanges: number) {
    for (const [stageName, stage] of Object.entries(this.stageComments)) {
      for (const [stackName, comment] of Object.entries(stage.stackComments)) {
        const hash = md5Hash(JSON.stringify({
          stageName,
          stackName,
        }));
        const stackComment = this.getCommentForStack(stageName, stackName, comment);
        if (stackComment.join('\n').length > MAX_COMMENT_LENGTH) {
          throw new Error(`Comment for stack ${stackName} is too long, please report this as a bug https://github.com/corymhall/cdk-diff-action/issues/new`);
        }
        const previous = await comments.findPrevious(hash);
        if (totalChanges === 0) {
          if (previous) {
            await comments.deleteComment(previous);
          }
          // Do not post a comment if there were no changes.
        } else if (previous) {
          await comments.updateComment(previous, hash, stackComment);
        } else {
          await comments.createComment(hash, stackComment);
        }
      }
    }
  }

  private async commentStage(comments: Comments, hash: string, comment: string[], totalChanges: number) {
    const previous = await comments.findPrevious(hash);
    if (totalChanges === 0) {
      if (previous) {
        await comments.deleteComment(previous);
      }
      // Do not post a comment if there were no changes.
    } else if (previous) {
      await comments.updateComment(previous, hash, comment);
    } else {
      await comments.createComment(hash, comment);
    }
  }

  /**
   * Create the GitHub comment for the stage
   * This will try to create a single comment per stage, but if the comment
   * is too long it will create a comment per stack
   * @param comments the comments object to use to create the comment
   */
  public async commentStages(comments: Comments) {
    for (const [stageName, info] of Object.entries(this.stageComments)) {
      const stageComment = this.getCommentForStage(stageName);
      let totalChanges = this.stageComments[stageName].totalChanges;
      if (stageComment.join('\n').length > MAX_COMMENT_LENGTH) {
        await this.commentStacks(comments, totalChanges);
      } else {
        await this.commentStage(comments, info.hash, stageComment, totalChanges);
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
      output.push(`No Changes for stack: ${stackName} ${emoji}`);
      return output;
    }
    output.push(...[
      `#### Diff for stack: ${stackName} - ` +
      `***${changes.createdResources} to add, ${changes.updatedResources} to update, ${changes.removedResources} to destroy***  ` +
      emoji,
      '<details><summary>Details</summary>',
      '',
    ]);
    if (changes.unknownEnvironment) {
      output.push('> [!INFO]\n> ***Unknown Environment*** :information_source:');
      output.push('> This stack has an unknown environment which may mean the diff is performed against the wrong environment');
      output.push(`> Environmment used ${changes.unknownEnvironment}`);
      output.push('');
    }
    if (changes.destructiveChanges.length) {
      output.push('');
      output.push('> [!WARNING]\n> ***Destructive Changes*** :bangbang:'),
      changes.destructiveChanges.forEach(change => {
        output.push(
          `> **Stack: ${change.stackName} - Resource: ${change.logicalId} - Impact:** ***${change.impact}***`,
        );
        output.push('');
      });
    }
    const writable = new StringWritable({});
    formatDifferences(writable, diff);

    output.push('');
    output.push('```shell');
    output.push(writable.data);
    output.push('```');
    output.push('</details>');
    output.push('');
    return output;
  }

  private getCommentForStack(stageName: string, stackName: string, comment: string[]): string[] {
    const output: string[] = [];
    if (!comment.length) {
      return output;
    }
    output.push(`### Diff for stack: ${stageName} / ${stackName}`);

    return output.concat(comment);
  }

  private getCommentForStage(stageName: string): string[] {
    const output: string[] = [];
    const stageComments = this.stageComments[stageName];
    const comments = Object.values(this.stageComments[stageName].stackComments).flatMap(x => x);
    if (!comments.length) {
      return output;
    }
    output.push(`### Diff for stage: ${stageName}`);

    if (stageComments.destructiveChanges) {
      output.push(`> [!WARNING]\n> ${stageComments.destructiveChanges} Destructive Changes`);
      output.push('');
    }
    return output.concat(comments);
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
