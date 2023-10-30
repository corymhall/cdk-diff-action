import { ResourceImpact } from '@aws-cdk/cloudformation-diff';
import { CloudFormationClient, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';
import { StackInfo } from '../src/assembly';
import { StackDiff, StageProcessor } from '../src/diff';

const cfnMock = mockClient(CloudFormationClient);

beforeEach(() => {
  cfnMock.reset();
});

describe('StackDiff', () => {
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
  test('no template diff', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const stackDiff = new StackDiff(stackInfo, []);
    const { diff, destructiveChanges } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(true);
    expect(destructiveChanges).toEqual([]);
  });

  test('diff with no destructive changes', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const stackDiff = new StackDiff({
      name: 'my-stack',
      content: {
        Resources: {
          MyRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyCustomName',
              Description: 'New Description',
            },
          },
        },
      },
    }, []);
    const { diff, destructiveChanges } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_UPDATE);
    expect(destructiveChanges).toEqual([]);
  });

  test('diff with destructive changes', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const stackDiff = new StackDiff({
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
    }, []);
    const { diff, destructiveChanges } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_REPLACE);
    expect(destructiveChanges).toEqual([{
      impact: ResourceImpact.WILL_REPLACE,
      logicalId: 'MyRole',
      stackName: 'my-stack',
    }]);
  });

  test('diff with allowed destructive changes', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const stackDiff = new StackDiff({
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
    }, ['AWS::IAM::Role']);
    const { diff, destructiveChanges } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_REPLACE);
    expect(destructiveChanges).toEqual([]);
  });
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
    expect(p.Stage1.comment.length).toEqual(0);
  });

  test('stage with no diff', async () => {
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

});
