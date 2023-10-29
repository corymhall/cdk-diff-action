import * as path from 'path';
import { AssemblyManifest, Manifest, ArtifactType, AwsCloudFormationStackProperties, NestedCloudAssemblyProperties, BootstrapRole } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';

/**
 * Trace information for stack
 * map of resource logicalId to trace message
 */
export type StackTrace = Map<string, string>;

/**
 * Trace information for a assembly
 *
 * map of stackId to StackTrace
 */
export type ManifestTrace = Map<string, StackTrace>;

/**
 * Reads a Cloud Assembly manifest
 */
export class AssemblyManifestReader {
  public static readonly DEFAULT_FILENAME = 'manifest.json';

  /**
   * Reads a Cloud Assembly manifest from a file
   */
  public static fromFile(fileName: string): AssemblyManifestReader {
    try {
      const obj = Manifest.loadAssemblyManifest(fileName);
      return new AssemblyManifestReader(path.dirname(fileName), obj);

    } catch (e: any) {
      throw new Error(`Cannot read integ manifest '${fileName}': ${e.message}`);
    }
  }

  /**
   * Reads a Cloud Assembly manifest from a file or a directory
   * If the given filePath is a directory then it will look for
   * a file within the directory with the DEFAULT_FILENAME
   */
  public static fromPath(filePath: string): AssemblyManifestReader {
    let st;
    try {
      st = fs.statSync(filePath);
    } catch (e: any) {
      throw new Error(`Cannot read integ manifest at '${filePath}': ${e.message}`);
    }
    if (st.isDirectory()) {
      return AssemblyManifestReader.fromFile(path.join(filePath, AssemblyManifestReader.DEFAULT_FILENAME));
    }
    return AssemblyManifestReader.fromFile(filePath);
  }

  /**
   * The directory where the manifest was found
   */
  public readonly directory: string;

  constructor(directory: string, private readonly manifest: AssemblyManifest) {
    this.directory = directory;
  }

  /**
   * Get the stacks from the manifest
   * returns a map of artifactId to CloudFormation template
   */
  public get stacks(): StackInfo[] {
    const stacks: StackInfo[] = [];
    for (const [artifactId, artifact] of Object.entries(this.manifest.artifacts ?? {})) {
      if (artifact.type !== ArtifactType.AWS_CLOUDFORMATION_STACK) { continue; }
      const props = artifact.properties as AwsCloudFormationStackProperties;
      const template = fs.readJSONSync(path.resolve(this.directory, props.templateFile));
      stacks.push({
        content: template,
        lookupRole: props.lookupRole,
        name: props.stackName ?? artifactId,
      });
    }
    return stacks;
  }

  public get stages(): StageInfo[] {
    const stages: StageInfo[] = [];
    for (const [artifactId, artifact] of Object.entries(this.manifest.artifacts ?? {})) {
      if (artifact.type !== ArtifactType.NESTED_CLOUD_ASSEMBLY) { continue; }
      const props = artifact.properties as NestedCloudAssemblyProperties;
      const nestedAssembly = AssemblyManifestReader.fromPath(path.join(this.directory, props.directoryName));
      stages.push({
        name: props.displayName ?? artifactId,
        stacks: nestedAssembly.stacks,
      });
    }
    return stages;
  }
}

export interface StageInfo {
  name: string;
  stacks: StackInfo[];
}

export interface StackInfo {
  name: string;
  lookupRole?: BootstrapRole;
  content: string;
}
