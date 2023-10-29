export interface Inputs {
  /**
   *
   */
  githubToken: string;

  /**
   * @default - there are no allowed destroy types
   */
  allowedDestroyTypes: string[];

  /**
   * @default false
   */
  failOnDestructiveChanges?: boolean;
}
