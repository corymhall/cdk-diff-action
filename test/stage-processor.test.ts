import * as fs from 'fs';
import path from 'path';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { StackInfo } from '../src/assembly';
import { Comments } from '../src/comment';
import { StageProcessor } from '../src/stage-processor';

let findPreviousMock = jest.fn();
let updateCommentMock = jest.fn();
let createCommentMock = jest.fn();
let deleteCommentMock = jest.fn();
jest.mock('../src/comment', () => {
  return {
    Comments: jest.fn().mockImplementation(() => {
      return {
        findPrevious: findPreviousMock,
        updateComment: updateCommentMock,
        createComment: createCommentMock,
        deleteComment: deleteCommentMock,
      };
    }),
  };
});

const cfnMock = mockClient(CloudFormationClient);
const stsMock = mockClient(STSClient);

beforeEach(() => {
  stsMock.on(GetCallerIdentityCommand).resolves({
    Account: '123456789012',
  });
});

afterEach(() => {
  cfnMock.reset();
  stsMock.reset();
  findPreviousMock.mockClear();
  updateCommentMock.mockClear();
  createCommentMock.mockClear();
});

describe('StageProcessor', () => {
  const env = {
    region: 'us-east-1',
    account: '123456789012',
  };
  const stackInfo: StackInfo = {
    name: 'my-stack',
    ...env,
    content: {
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    },
  };

  test('stage with no diffs', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const processor = new StageProcessor([
      {
        name: 'Stage1',
        stacks: [stackInfo],
      },
    ], []);
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      Stage1: expect.any(Object),
    });
    expect(p.Stage1.stackComments['my-stack']).toEqual(['No Changes for stack: my-stack :white_check_mark:']);
  });

  test('stage with diff', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const processor = new StageProcessor([
      {
        name: 'Stage1',
        stacks: [{
          name: 'my-stack',
          ...env,
          content: {
            Resources: {
              MyRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  RoleName: 'MyNewCustomName',
                },
              },
            },
          },
        }],
      },
    ], []);
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      Stage1: expect.any(Object),
    });
    expect(p.Stage1.stackComments['my-stack'].length).not.toEqual(0);
    expect(p.Stage1.destructiveChanges).toEqual(1);
  });

  test('stage with destructive changes-ignored', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const processor = new StageProcessor([
      {
        name: 'Stage1',
        stacks: [{
          ...env,
          name: 'my-stack',
          content: {
            Resources: {
              MyRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  RoleName: 'MyNewCustomName2',
                },
              },
            },
          },
        }],
      },
    ], []);
    await processor.processStages(['Stage1']);
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      Stage1: expect.any(Object),
    });
    expect(p.Stage1.stackComments['my-stack'].length).not.toEqual(0);
    expect(p.Stage1.destructiveChanges).toEqual(0);
  });

  test('new comment created', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const processor = new StageProcessor([
      {
        name: 'Stage1',
        stacks: [{
          name: 'my-stack',
          ...env,
          content: {
            Resources: {
              MyRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  RoleName: 'MyNewCustomName2',
                },
              },
            },
          },
        }],
      },
    ], []);
    await processor.processStages(['Stage1']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(createCommentMock).toHaveBeenCalledTimes(1);
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(updateCommentMock).toHaveBeenCalledTimes(0);
  });

  test('comment updated', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const processor = new StageProcessor([
      {
        name: 'Stage1',
        stacks: [{
          name: 'my-stack',
          ...env,
          content: {
            Resources: {
              MyRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  RoleName: 'MyNewCustomName2',
                },
              },
            },
          },
        }],
      },
    ], []);
    findPreviousMock.mockResolvedValue(1);
    await processor.processStages(['Stage1']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(1);
  });

  test('stack level comments', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify({
          name: 'my-stack',
          content: {
            Resources: {
              MyRole: {
                Type: 'AWS::IAM::Role',
                Properties: {
                  RoleName: 'MyCustomName',
                  Property1: fs.readFileSync(path.join(__dirname, '../', 'src', 'stage-processor.ts'), 'utf-8'),
                },
              },
            },
          },

        }),
      });
    const processor = new StageProcessor([
      {
        name: 'Stage1',
        stacks: createStacks(10),
      },
    ], []);
    findPreviousMock.mockResolvedValue(1);
    await processor.processStages(['Stage1']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(findPreviousMock).toHaveBeenCalledTimes(10);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(0);
    expect(deleteCommentMock).toHaveBeenCalledTimes(10);
  });
});

function createStacks(numStacks: number): any[] {
  const stacks: any[] = [];
  for (let i = 0; i < numStacks; i++) {
    stacks.push({
      name: `my-stack${i}`,
      account: '123456789012',
      region: 'us-east-1',
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyNewCustomName2',
              Property1: fs.readFileSync(path.join(__dirname, 'stage-processor.test.ts'), 'utf-8'),
            },
          },
        },
      },
    });
  }
  return stacks;

}
