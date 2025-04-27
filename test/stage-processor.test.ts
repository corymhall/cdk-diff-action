import * as fs from 'fs';
import path from 'path';
import { DifferenceCollection, ResourceDifference, ResourceImpact, TemplateDiff } from '@aws-cdk/cloudformation-diff';
import { Toolkit, DiffMethod, IIoHost, IoMessage, IoRequest } from '@aws-cdk/toolkit-lib';
import mock from 'mock-fs';
import { Comments } from '../src/comment';
import { AssemblyProcessor } from '../src/stage-processor';

class FakeIoHost implements IIoHost {
  notify(_msg: IoMessage<unknown>): Promise<void> {
    return Promise.resolve();
  }
  requestResponse<T, U>(_msg: IoRequest<T, U>): Promise<U> {
    return Promise.resolve({} as U);
  }
}

const toolkit = new Toolkit({
  ioHost: new FakeIoHost(),
});

let findPreviousMock = jest.fn();
let updateCommentMock = jest.fn();
let createCommentMock = jest.fn();
jest.mock('../src/comment', () => {
  return {
    Comments: jest.fn().mockImplementation(() => {
      return {
        findPrevious: findPreviousMock,
        updateComment: updateCommentMock,
        createComment: createCommentMock,
      };
    }),
  };
});


const cdkout = {
  'manifest.json': JSON.stringify({
    version: '17.0.0',
    artifacts: {
      'assembly-SomeStage': {
        type: 'cdk:cloud-assembly',
        properties: {
          directoryName: 'assembly-SomeStage',
          displayName: 'SomeStage',
        },
      },
    },
  }),
  ['assembly-SomeStage']: {
    ['manifest.json']: JSON.stringify({
      version: '17.0.0',
      artifacts: {
        'SomeStage-test-stack': {
          type: 'aws:cloudformation:stack',
          environment: 'aws://unknown-account/unknown-region',
          properties: {
            templateFile: 'SomeStage-test-stack.template.json',
            validateOnSynth: false,
          },
          stackName: 'SomeStage-test-stack',
        },
      },
    }),
    ['SomeStage-test-stack.template.json']: JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    }),
  },
};

let mockOutDir: any;

beforeEach(() => {
  mockOutDir = cdkout;
});

afterEach(() => {
  mock.restore();
  findPreviousMock.mockClear();
  updateCommentMock.mockClear();
  createCommentMock.mockClear();
});

describe('StageProcessor', () => {
  test('stage with no diffs', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName',
          },
        },
      },
    });
    mock({
      'cdk.out': mockOutDir,
      'node_modules': mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile('cdk.out/SomeStage-test-stack.template.json'),
      failOnDestructiveChanges: true,
      noDiffForStages: [],
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(p.SomeStage.stackComments['SomeStage-test-stack']).toEqual(['No Changes for stack: SomeStage-test-stack :white_check_mark:']);
  });

  test('stage with diff', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      'cdk.out': mockOutDir,
      'node_modules': mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile('cdk.out/SomeStage-test-stack.template.json'),
      failOnDestructiveChanges: true,
      noDiffForStages: [],
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages();
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(p.SomeStage.stackComments['SomeStage-test-stack'].length).not.toEqual(0);
    expect(p.SomeStage.destructiveChanges).toEqual(1);
  });

  test('stage with destructive changes-ignored', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      'cdk.out': mockOutDir,
      'node_modules': mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile('cdk.out/SomeStage-test-stack.template.json'),
      failOnDestructiveChanges: true,
      noDiffForStages: [],
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages(['SomeStage']);
    const p = (processor as any).stageComments;
    expect(p).toEqual({
      SomeStage: expect.any(Object),
    });
    expect(p.SomeStage.stackComments['SomeStage-test-stack'].length).not.toEqual(0);
    expect(p.SomeStage.destructiveChanges).toEqual(0);
  });

  test('new comment created', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      'cdk.out': mockOutDir,
      'node_modules': mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile('cdk.out/SomeStage-test-stack.template.json'),
      failOnDestructiveChanges: true,
      noDiffForStages: [],
      noFailOnDestructiveChanges: [],
    });
    await processor.processStages(['SomeStage']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(createCommentMock).toHaveBeenCalledTimes(1);
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(updateCommentMock).toHaveBeenCalledTimes(0);
  });

  test('comment updated', async () => {
    mockOutDir['SomeStage-test-stack.template.json'] = JSON.stringify({
      Resources: {
        MyRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            RoleName: 'MyCustomName2',
          },
        },
      },
    });
    mock({
      'cdk.out': mockOutDir,
      'node_modules': mock.load(path.join(__dirname, '..', 'node_modules')),
    });
    const processor = new AssemblyProcessor({
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.LocalFile('cdk.out/SomeStage-test-stack.template.json'),
      failOnDestructiveChanges: true,
      noDiffForStages: [],
      noFailOnDestructiveChanges: [],
    });
    findPreviousMock.mockResolvedValue(1);
    await processor.processStages(['SomeStage']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(findPreviousMock).toHaveBeenCalledTimes(1);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(1);
  });
});

describe('stack comments', () => {
  afterEach(() => {
    jest.resetAllMocks(); // clears mock state
    jest.restoreAllMocks(); // Restores original implementations
  });
  test('stack level comments', async () => {
    const manifestJson = {
      version: '17.0.0',
      artifacts: {},
    };

    const stacks = createStacks(10);
    stacks.forEach((stack) => {
      mockOutDir[`${stack.name}.template.json`] = JSON.stringify(stack.content);
      manifestJson.artifacts[stack.name] = {
        type: 'aws:cloudformation:stack',
        environment: 'aws://1234567891012/us-east-1',
        properties: {
          templateFile: `${stack.name}.template.json`,
          validateOnSynth: false,
        },
        stackName: stack.name,
      };
    });
    mockOutDir['assembly-SomeStage'] = JSON.stringify(manifestJson);
    const diffInfo: { [stackName: string]: DiffInfo } = {};
    stacks.forEach((stack) => {
      diffInfo[stack.name] = {
        oldValue: 'MyCustomName',
        newValue: fs.readFileSync(path.join(__dirname, '../', 'src', 'stage-processor.ts'), 'utf-8'),
      };
    });
    const templateDiff = createTemplateDiffs(diffInfo);
    mock({
      'cdk.out': mockOutDir,
      'node_modules': mock.load(path.join(__dirname, '..', 'node_modules')),
    });

    jest.spyOn(Toolkit.prototype, 'diff').mockResolvedValue(templateDiff);
    const processor = new AssemblyProcessor({
      toolkit,
      allowedDestroyTypes: [],
      cdkOutDir: 'cdk.out',
      diffMethod: DiffMethod.TemplateOnly(),
      failOnDestructiveChanges: true,
      noDiffForStages: [],
      noFailOnDestructiveChanges: [],
    });
    findPreviousMock.mockResolvedValue(1);
    await processor.processStages(['SomeStage']);
    await processor.commentStages(new Comments({} as any, {} as any));
    expect(findPreviousMock).toHaveBeenCalledTimes(10);
    expect(createCommentMock).toHaveBeenCalledTimes(0);
    expect(updateCommentMock).toHaveBeenCalledTimes(10);
  });
});

interface DiffInfo {
  oldValue: string;
  newValue: string;
}

function createTemplateDiffs(stacks: { [name: string]: DiffInfo}): { [name: string]: TemplateDiff } {
  const templateDiff: { [name: string]: TemplateDiff } = {};
  for (const [stackName, diffInfo] of Object.entries(stacks)) {
    const isreplace = diffInfo.oldValue !== diffInfo.newValue;
    templateDiff[stackName] = new TemplateDiff({
      resources: new DifferenceCollection({
        MyRole: new ResourceDifference(
          { Type: 'AWS::IAM::Role', Properties: { RoleName: diffInfo.oldValue } },
          { Type: 'AWS::IAM::Role', Properties: { RoleName: diffInfo.newValue } },
          {
            resourceType: { newType: 'AWS::IAM::Role', oldType: 'AWS::IAM::Role' },
            otherDiffs: {},
            propertyDiffs: {
              RoleName: {
                isUpdate: isreplace,
                isAddition: false,
                isDifferent: isreplace,
                isRemoval: false,
                newValue: diffInfo.newValue,
                oldValue: diffInfo.oldValue,
                changeImpact: isreplace ? ResourceImpact.WILL_REPLACE : ResourceImpact.NO_CHANGE,
              },
            },
          },
        ),
      }),
    });
  }
  return templateDiff;
}

function createStacks(numStacks: number): any[] {
  const stacks: any[] = [];
  for (let i = 0; i < numStacks; i++) {
    stacks.push({
      name: `SomeStage-my-stack${i}`,
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
