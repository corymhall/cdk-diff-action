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
    const { diff, changes } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(true);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
  });

  test('diff with changes', async () => {
    cfnMock.on(GetTemplateCommand)
      .resolves({
        TemplateBody: JSON.stringify(stackInfo.content),
      });
    const stackDiff = new StackDiff({
      name: 'my-stack',
      content: {
        Resources: {
          MyRole2: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'MyCustomName',
              Description: 'New Description',
            },
          },
        },
      },
    }, []);
    const { diff, changes } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(changes).toEqual({
      updatedResources: 0,
      removedResources: 1,
      createdResources: 1,
      destructiveChanges: [{
        impact: ResourceImpact.WILL_DESTROY,
        logicalId: 'MyRole',
        stackName: 'my-stack',
      }],
    });
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
    const { diff, changes } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_UPDATE);
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
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
    const { diff, changes } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_REPLACE);
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [{
        impact: ResourceImpact.WILL_REPLACE,
        logicalId: 'MyRole',
        stackName: 'my-stack',
      }],
    });
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
    const { diff, changes } = await stackDiff.diffStack();
    expect(diff.isEmpty).toEqual(false);
    expect(diff.differenceCount).toEqual(1);
    expect(diff.resources.changes.MyRole.changeImpact).toEqual(ResourceImpact.WILL_REPLACE);
    expect(changes).toEqual({
      updatedResources: 1,
      removedResources: 0,
      createdResources: 0,
      destructiveChanges: [],
    });
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
    expect(p.Stage1.comment).toEqual(['No Changes for stack: my-stack']);
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

});
