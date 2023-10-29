import { Context } from '@actions/github/lib/context';
import { GitHub } from '@actions/github/lib/utils';

export class Comments {
  private readonly issueNumber: number;
  constructor(
    private readonly octokit: InstanceType<typeof GitHub>,
    private readonly context: Context,
  ) {
    if (!context.payload.pull_request?.number) {
      throw new Error('Cannot find PR number, is this from a pull request?');
    }
    this.issueNumber = this.context.payload.pull_request?.number!;
  }

  public async findPrevious(hash: string): Promise<number | undefined> {
    const comments = await this.octokit.rest.issues.listComments({
      ...this.context.repo,
      issue_number: this.issueNumber,
    });
    return comments.data.find(comment => comment.body_text?.includes(hash))?.id;
  }

  public async updateComment(commentId: number, hash: string, content: string[]) {
    await this.octokit.rest.issues.updateComment({
      ...this.context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        ...content,
      ].join('\n'),
      comment_id: commentId,
    });
  }

  public async createComment(hash: string, content: string[]) {
    await this.octokit.rest.issues.createComment({
      ...this.context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        ...content,
      ].join('\n'),
      issue_number: this.issueNumber,
    });
  }

}
