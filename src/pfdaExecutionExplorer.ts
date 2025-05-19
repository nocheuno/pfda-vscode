import * as vscode from 'vscode';
import { PfdaCli } from './pfdaCli';
import { PfdaExecutionNode } from './pfdaExecutionNode';

export class PfdaExecutionExplorer implements vscode.TreeDataProvider<PfdaExecutionNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<PfdaExecutionNode | undefined | null | void> = new vscode.EventEmitter<PfdaExecutionNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PfdaExecutionNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private executionNodes: PfdaExecutionNode[] = [];
  private pfdaCli: PfdaCli;
  private activeSpaceId: string | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) {
      throw new Error('No workspace folder is open');
    }
    
    // Initialize PfdaCli instance
    this.pfdaCli = new PfdaCli(rootPath);
    
    // Register view
    const view = vscode.window.createTreeView('pfdaExecutionExplorer', { 
      treeDataProvider: this, 
      showCollapseAll: true,
      canSelectMany: true
    });
    
    // Register commands
    this.disposables.push(view);
    this.disposables.push(vscode.commands.registerCommand('pfdaExecutionExplorer.refresh', () => this.refresh()));
    this.disposables.push(vscode.commands.registerCommand('pfdaExecutionExplorer.terminateExecution', (node: PfdaExecutionNode) => this.terminateExecution(node)));
    this.disposables.push(vscode.commands.registerCommand('pfdaExecutionExplorer.rerunExecution', (node: PfdaExecutionNode) => this.rerunExecution(node)));
    // Register command for opening execution in external browser
    this.disposables.push(vscode.commands.registerCommand('pfdaExecutionExplorer.openExternal', (node: PfdaExecutionNode) => this.openExternal(node)));
    
    // Initialize and load executions
    this.initialize();
  }
  
  /**
   * Initialize the execution explorer
   */
  private async initialize(): Promise<void> {
    console.log('PfdaExecutionExplorer: Initializing');
    
    // Add a small delay to ensure the view is ready
    setTimeout(async () => {
      try {
        console.log('PfdaExecutionExplorer: Loading executions');
        await this.refresh();
        console.log('PfdaExecutionExplorer: Executions loaded');
      } catch (error) {
        console.error('Error initializing execution explorer:', error);
      }
    }, 1500); // Small delay to ensure the view is ready
  }

  getTreeItem(element: PfdaExecutionNode): vscode.TreeItem {
    // Create a tree item from the execution node
    const treeItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    
    // Set description and tooltip
    treeItem.description = element.description;
    
    // Create a rich tooltip with all available information
    treeItem.tooltip = new vscode.MarkdownString(`
### Execution Details
- **ID:** ${element.id}
- **DX ID:** ${element.dxid}
- **App:** ${element.appTitle}
- **Status:** ${element.status}
- **Started:** ${element.startedAt}
- **Instance Type:** ${element.instanceType}
- **Launched By:** ${element.launchedBy}
- **Cost:** ${element.energyConsumption}
    `);
    
    // Set context value for menu contributions
    treeItem.contextValue = this.getContextValueForStatus(element.status);
    
    // Set icon based on execution status
    treeItem.iconPath = this.getIconForStatus(element.status);
    // Only attach external-open command for running executions
    const status = element.status.toLowerCase();
    if (element.openExternal && (status === 'running')) {
      treeItem.command = {
        command: 'pfdaExecutionExplorer.openExternal',
        title: 'Open in Browser',
        arguments: [element]
      };
    }
    
    return treeItem;
  }

  getChildren(element?: PfdaExecutionNode): Thenable<PfdaExecutionNode[]> {
    if (element) {
      // No children for execution nodes
      return Promise.resolve([]);
    }

    // Return top-level execution nodes
    return Promise.resolve(this.executionNodes);
  }

  // Update the view with the new active space ID
  updateActiveSpace(spaceId: string): void {
    console.log(`PfdaExecutionExplorer: Updating active space to ${spaceId}`);
    this.activeSpaceId = spaceId;
    this.refresh();
  }

  // Refresh the execution list
  async refresh(): Promise<void> {
    try {
      await this.loadExecutions();
      this._onDidChangeTreeData.fire();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to refresh executions: ${error}`);
    }
  }

  // Load executions from PFDA CLI
  private async loadExecutions(): Promise<void> {
    // Clear current executions
    this.executionNodes = [];
    
    try {
      // Call PFDA CLI to list executions
      let args = ['ls-executions'];
      
      // Handle the special "My Home" space and regular spaces differently
      if (this.activeSpaceId === 'my-home') {
        console.log(`PfdaExecutionExplorer: Listing executions for My Home (no space-id parameter)`);
        // Don't add space-id parameter for My Home
      } else if (this.activeSpaceId) {
        console.log(`PfdaExecutionExplorer: Listing executions for space ID: ${this.activeSpaceId}`);
        args = args.concat(['-space-id', this.activeSpaceId]);
      } else {
        console.log('PfdaExecutionExplorer: No active space, defaulting to My Home');
        // If no space is selected, don't add a space-id parameter (My Home behavior)
      }
      
      const result = await this.pfdaCli.callPfdaCli(args);

      if (result && Array.isArray(result)) {
        // Parse execution data from the API response, newest on top
        this.executionNodes = [...result].reverse().map(execution => {
          const jobName = execution.name || `Job-${execution.id}`;
          const jobDescription = `${execution.appTitle || ''} (${execution.state})`;
          const startTime = execution.createdAt || execution.createdAtDateTime || 'Unknown';
          const openExternal = !!execution.workstationApiVersion;
          
          return new PfdaExecutionNode(
            execution.id,
            jobName,
            jobDescription,
            execution.state,
            startTime,
            this.activeSpaceId || 'my-home',
            String(execution.uid),
            execution.dxid || '',
            execution.appTitle || 'Unknown',
            execution.instanceType || 'Unknown',
            execution.launchedBy || 'Unknown',
            execution.energyConsumption || 'Unknown',
            openExternal,
          );
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load executions: ${error}`);
    }
  }

  // Terminate an execution
  private async terminateExecution(node: PfdaExecutionNode): Promise<void> {
    try {
      // Confirm termination
      const answer = await vscode.window.showWarningMessage(
        `Are you sure you want to terminate execution '${node.label}'?`,
        { modal: true },
        'Yes',
        'No'
      );
      
      if (answer !== 'Yes') {
        return;
      }
      
      // Call PFDA CLI to terminate the execution - convert id to string
      await this.pfdaCli.callPfdaCli(['terminate-execution', '-execution-id', String(node.id)]);
      
      vscode.window.showInformationMessage(`Successfully terminated execution: ${node.label}`);
      
      // Refresh the list
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to terminate execution: ${error}`);
    }
  }

  // Rerun an execution
  private async rerunExecution(node: PfdaExecutionNode): Promise<void> {
    try {
      // Call PFDA CLI to rerun the execution - convert id to string
      await this.pfdaCli.callPfdaCli(['rerun-execution', '-execution-id', String(node.id)]);
      
      vscode.window.showInformationMessage(`Successfully rerun execution: ${node.label}`);
      
      // Refresh the list
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rerun execution: ${error}`);
    }
  }

  // Open execution in external browser
  private async openExternal(node: PfdaExecutionNode): Promise<void> {
    const uid = node.uid;
    const url = `https://precision.fda.gov/api/jobs/${uid}/open_external`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  // Get icon based on execution status
  private getIconForStatus(status: string): { light: vscode.Uri; dark: vscode.Uri } {
    let statusIconName: string;
    
    switch (status.toLowerCase()) {
      case 'running':
      case 'in progress':
        statusIconName = 'running.svg';
        break;
      case 'completed':
      case 'succeeded':
      case 'done':
        statusIconName = 'done.svg';
        break;
      case 'failed':
      case 'error':
        statusIconName = 'failed.svg';
        break;
      case 'terminated':
      case 'terminating':
        statusIconName = 'terminated.svg';
        break;
      case 'waiting':
      case 'queued':
        statusIconName = 'idle.svg';
        break;
      case 'ready':
      case 'runnable':
        statusIconName = 'runnable.svg';
        break;
      default:
        statusIconName = 'idle.svg';
    }
    
    return {
      light: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'light', 'status', statusIconName))),
      dark: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'dark', 'status', statusIconName)))
    };
  }

  // Get context value based on execution status
  private getContextValueForStatus(status: string): string {
    switch (status.toLowerCase()) {
      case 'running':
      case 'in progress':
        return 'execution-running';
      case 'terminated':
      case 'terminating':
        return 'execution-terminated';
      case 'done':
      case 'completed':
      case 'succeeded':
        return 'execution-completed';
      case 'failed':
      case 'error':
        return 'execution-failed';
      default:
        return 'execution';
    }
  }

  // Clean up resources when disposing
  dispose(): void {
    // Dispose all registered disposables
    this.disposables.forEach(d => d.dispose());
  }
}

// Need to import path
import * as path from 'path';
