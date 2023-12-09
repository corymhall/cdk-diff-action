import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';
import { StackInfo } from '../src/assembly';
import { StageProcessor } from '../src/stage-processor';

const cfnMock = mockClient(CloudFormationClient);

beforeEach(() => {
  cfnMock.reset();
});

describe('StageProcessor', () => {
  const stackInfo: StackInfo = {
    name: 'my-stack',
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
    expect(p.Stage1.comment).toEqual(['No Changes for stack: my-stack :white_check_mark:']);
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
    expect(p.Stage1.comment.length).not.toEqual(0);
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
    expect(p.Stage1.comment.length).not.toEqual(0);
    expect(p.Stage1.destructiveChanges).toEqual(0);
  });

});
