import * as path from 'path';
import mock from 'mock-fs';
import { AssemblyManifestReader } from '../src/assembly';

describe('cloud assembly manifest reader', () => {
  const manifestFile = 'cdk.out/manifest.json';
  const lookupRoleArn = 'arn:${AWS::Partition}:iam::123456789012:role/cdk-hnb659fds-lookup-role-123456789012-us-east-1';
  beforeEach(() => {
    mock({
      ['cdk.out']: {
        ['assembly-SomeStage']: {
          ['manifest.json']: JSON.stringify({
            version: '17.0.0',
            artifacts: {
              'test-stack2': {
                type: 'aws:cloudformation:stack',
                environment: 'aws://unknown-account/unknown-region',
                properties: {
                  templateFile: 'test-stack.template.json',
                  validateOnSynth: false,
                },
                displayName: 'test-stack',
              },
            },
          }),
          ['test-stack.template.json']: JSON.stringify({
            data: 'data',
          }),
        },
        ['test-stack.template.json']: JSON.stringify({
          data: 'data',
        }),
        ['manifest.json']: JSON.stringify({
          version: '17.0.0',
          artifacts: {
            'assembly-SomeStage': {
              type: 'cdk:cloud-assembly',
              properties: {
                directoryName: 'assembly-SomeStage',
                displayName: 'SomeStage',
              },
            },
            'test-stack': {
              type: 'aws:cloudformation:stack',
              environment: 'aws://1234567891012/us-east-1',
              properties: {
                templateFile: 'test-stack.template.json',
                validateOnSynth: false,
                lookupRole: {
                  arn: lookupRoleArn,
                  requiresBootstrapStackVersion: 8,
                  bootstrapStackVersionSsmParameter: '/cdk-bootstrap/hnb659fds/version',
                },
              },
              displayName: 'test-stack',
            },
          },
        }),

      },
    });
  });

  afterEach(() => {
    mock.restore();
  });

  test('can read manifest from file', () => {
    expect(() => {
      AssemblyManifestReader.fromFile(manifestFile);
    }).not.toThrow();
  });

  test('throws if manifest not found', () => {
    expect(() => {
      AssemblyManifestReader.fromFile('some-other-file');
    }).toThrow(/Cannot read integ manifest 'some-other-file':/);
  });

  test('can read manifest from path', () => {
    expect(() => {
      AssemblyManifestReader.fromPath(path.dirname(manifestFile));
    }).not.toThrow();
  });

  test('fromPath sets directory correctly', () => {
    const manifest = AssemblyManifestReader.fromPath(path.dirname(manifestFile));
    expect(manifest.directory).toEqual('cdk.out');
  });

  test('get root stacks', () => {
    const manifest = AssemblyManifestReader.fromFile(manifestFile);

    expect(manifest.stacks).toEqual([
      {
        name: 'test-stack',
        content: { data: 'data' },
        region: 'us-east-1',
        account: '1234567891012',
        lookupRole: expect.objectContaining({
          arn: lookupRoleArn,
        }),
      },
    ]);
  });
  test('get stages', () => {
    const manifest = AssemblyManifestReader.fromFile(manifestFile);

    expect(manifest.stages).toEqual([
      {
        name: 'SomeStage',
        region: undefined,
        account: undefined,
        stacks: [{
          name: 'test-stack2',
          content: { data: 'data' },
        }],
      },
    ]);
  });
});
