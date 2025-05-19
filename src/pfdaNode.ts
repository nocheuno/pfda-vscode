export class PfdaNode {
  // Reference to parent node for easier navigation
  public parent?: PfdaNode;
  
  constructor(
    readonly id: string,
    readonly label: string,
    readonly path: string,
    readonly isDirectory: boolean,
    readonly extension?: string
  ) {}
  
  /**
   * Set the parent reference for this node
   * @param parent The parent node
   */
  public setParent(parent: PfdaNode): void {
    this.parent = parent;
  }
}
