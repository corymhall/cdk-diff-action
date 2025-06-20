import * as core from '@actions/core';
import { CloudAssembly } from '@aws-cdk/cx-api';
import mock from 'mock-fs';
import { AssemblyManifestReader } from '../src/assembly';

jest.spyOn(core, 'debug').mockImplementation(() => {});

describe('cloud assembly manifest reader', () => {
  beforeEach(() => {
    mock({
      ['cdk.out']: {
        ['assembly-SomeStage']: {
          ['manifest.json']: JSON.stringify({
            version: '17.0.0',
            artifacts: {
              'SomeStage-test-stack2': {
                type: 'aws:cloudformation:stack',
                environment: 'aws://unknown-account/unknown-region',
                properties: {
                  templateFile: 'test-stack.template.json',
                  validateOnSynth: false,
                  stackName: 'SomeStage-test-stack2',
                },
                displayName: 'SomeStage/test-stack2',
              },
            },
          }),
          ['SomeStage-test-stack2.template.json']: JSON.stringify({
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
                stackName: 'test-stack',
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

  test('get root stacks', () => {
    const assembly = new CloudAssembly('cdk.out', {
      skipVersionCheck: true,
    });
    const manifest = new AssemblyManifestReader(assembly, {
      'test-stack': {} as any,
    });

    expect(manifest.stacks).toEqual([
      {
        name: 'test-stack',
      },
    ]);
  });
  test('get stages', () => {
    const assembly = new CloudAssembly('cdk.out', {
      skipVersionCheck: true,
    });

    const manifest = new AssemblyManifestReader(assembly, {
      'test-stack': {} as any,
      'SomeStage/test-stack2': {} as any,
    });

    expect(manifest.stages).toEqual([
      {
        name: 'SomeStage',
        stacks: [
          {
            name: 'SomeStage/test-stack2',
          },
        ],
      },
    ]);
  });

  test('only stages with stacks', () => {
    const assembly = new CloudAssembly('cdk.out', {
      skipVersionCheck: true,
    });

    const manifest = new AssemblyManifestReader(assembly, {
      'test-stack': {} as any,
    });

    expect(manifest.stages).toEqual([]);
    expect(manifest.stacks).toEqual([
      {
        name: 'test-stack',
      },
    ]);
  });
});
