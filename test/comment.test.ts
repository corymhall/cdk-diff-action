import * as core from '@actions/core';
import type { Context } from '@actions/github/lib/context';
import type { GitHub } from '@actions/github/lib/utils';
import { Comments } from '../src/comment';

jest.spyOn(core, 'debug').mockImplementation(() => {});

const createComment = jest.fn();
const updateComment = jest.fn();
const listComments = jest.fn();
const issues = { createComment, updateComment, listComments };

const rest = { issues };
const octokit = { rest } as unknown as InstanceType<typeof GitHub>;
let timestamp = '';

const context: Context = {
  sha: 'some-sha',
  payload: {
    repository: {
      full_name: 'some-repo',
    },
    pull_request: {
      head: { sha: '123' },
      number: 1,
    },
  },
} as unknown as Context;
// const pullRequestData = {
//   data: {
//     items: [
//       {
//         number: 1,
//       },
//     ],
//   },
// };
const hash = '761811df765e65db8321b6c4002ca358';
const commentDataWithTag = {
  data: [
    {
      id: 1,
      body: 'some comment',
    },
    {
      id: 2,
      body: `<!-- cdk diff action with hash ${hash} -->\nprevious-message`,
    },
  ],
};

const commentDataWithUnMatchedTag = {
  data: [
    {
      id: 1,
      body: 'some comment',
    },
    {
      id: 2,
      body: '<!-- cdk diff action with hash SOME-DIFFERENT-HASH -->\nprevious-message',
    },
  ],
};

beforeEach(() => {
  createComment.mockClear();
  updateComment.mockClear();
  jest.useFakeTimers({
    now: new Date('2021-02-26T22:42:16.652Z'),
    advanceTimers: true,
  });
  timestamp = new Date().toISOString();
});

describe('comments', () => {
  test('found previous comment with hash', async () => {
    listComments.mockResolvedValue(commentDataWithTag);
    const comments = new Comments(octokit, context);
    await expect(comments.findPrevious(hash)).resolves.toEqual(2);
  });

  test('found previous comment with different hash', async () => {
    listComments.mockResolvedValue(commentDataWithUnMatchedTag);
    const comments = new Comments(octokit, context);
    await expect(comments.findPrevious(hash)).resolves.toBeUndefined();
  });

  test('no comments', async () => {
    listComments.mockResolvedValue({ data: [] });
    const comments = new Comments(octokit, context);
    await expect(comments.findPrevious(hash)).resolves.toBeUndefined();
  });

  test('update comment', async () => {
    updateComment.mockResolvedValue({});
    const comments = new Comments(octokit, context);
    expect(comments.updateComment(1, hash, ['message'])).resolves;
    expect(updateComment).toHaveBeenCalledWith({
      ...context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        'message',
        '',
        `_Generated for commit ${context.payload.pull_request?.head.sha} at ${timestamp}_`,
      ].join('\n'),
      comment_id: 1,
    });
  });

  test('create comment', async () => {
    createComment.mockResolvedValue({});
    const comments = new Comments(octokit, context);
    expect(comments.createComment(hash, ['message'])).resolves;
    expect(createComment).toHaveBeenCalledWith({
      ...context.repo,
      body: [
        `<!-- cdk diff action with hash ${hash} -->`,
        'message',
        '',
        `_Generated for commit ${context.payload.pull_request?.head.sha} at ${timestamp}_`,
      ].join('\n'),
      issue_number: context.payload.pull_request?.number,
    });
  });
});
