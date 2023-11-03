/**
 * Inputs to the GH Workflow
 */
export interface Inputs {
  /**
   * The GitHub TOKEN to use to create the comment
   */
  githubToken: string;

  /**
   * A list of CloudFormation resource types that are allowed
   * to be destroyed.
   *
   * @default - there are no allowed destroy types
   */
  allowedDestroyTypes: string[];

  /**
   * Whether the workflow will fail if there are any non-allowed
   * destructive changes
   *
   * @default true
   */
  failOnDestructiveChanges: boolean;
}
