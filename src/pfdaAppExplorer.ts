import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PfdaCli } from './pfdaCli';
import { PfdaAppNode, PfdaAppNodeType, AppRunTemplate } from './pfdaAppNode';

export class PfdaAppExplorer implements vscode.TreeDataProvider<PfdaAppNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<PfdaAppNode | undefined | null | void> = new vscode.EventEmitter<PfdaAppNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<PfdaAppNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private appNodes: PfdaAppNode[] = [];
  private pfdaCli: PfdaCli;
  private activeSpaceId: string | undefined;
  private disposables: vscode.Disposable[] = [];
  private rootPath: string;

  constructor(private context: vscode.ExtensionContext) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) {
      throw new Error('No workspace folder is open');
    }
    
    this.rootPath = rootPath;
    
    // Initialize PfdaCli instance
    this.pfdaCli = new PfdaCli(rootPath);
    // Restore saved active space ID if available
    const savedSpace = this.context.workspaceState.get<string>('activeSpaceId');
    if (savedSpace) {
      console.log(`PfdaAppExplorer: Restoring active space from workspace state: ${savedSpace}`);
      this.activeSpaceId = savedSpace;
    }
    
    // Register view
    const view = vscode.window.createTreeView('pfdaAppExplorer', { 
      treeDataProvider: this, 
      showCollapseAll: true,
      canSelectMany: false
    });
    
    // Register commands
    this.disposables.push(view);
    this.disposables.push(vscode.commands.registerCommand('pfdaAppExplorer.refresh', () => this.refresh()));
    this.disposables.push(vscode.commands.registerCommand('pfdaAppExplorer.openApp', (node: PfdaAppNode) => this.openApp(node)));
    this.disposables.push(vscode.commands.registerCommand('pfdaAppExplorer.createTemplate', (node: PfdaAppNode) => this.createTemplate(node)));
    this.disposables.push(vscode.commands.registerCommand('pfdaAppExplorer.editTemplate', (node: PfdaAppNode) => this.editTemplate(node)));
    this.disposables.push(vscode.commands.registerCommand('pfdaAppExplorer.deleteTemplate', (node: PfdaAppNode) => this.deleteTemplate(node)));
    this.disposables.push(vscode.commands.registerCommand('pfdaAppExplorer.runTemplate', (node: PfdaAppNode) => this.runTemplate(node)));
    
    // Initialize and load apps
    this.initialize();
  }
  
  /**
   * Initialize the app explorer
   */
  private async initialize(): Promise<void> {
    console.log('PfdaAppExplorer: Initializing');
    
    // Add a small delay to ensure the view is ready
    setTimeout(async () => {
      try {
        console.log('PfdaAppExplorer: Loading apps');
        await this.refresh();
        console.log('PfdaAppExplorer: Apps loaded');
      } catch (error) {
        console.error('Error initializing app explorer:', error);
      }
    }, 1500); // Small delay to ensure the view is ready
  }

  getTreeItem(element: PfdaAppNode): vscode.TreeItem {
    // Check if this is an App or a Template
    if (element.type === PfdaAppNodeType.App) {
      // Create a collapsible app node
      const treeItem = new vscode.TreeItem(
        element.label, 
        vscode.TreeItemCollapsibleState.Collapsed
      );
      
      // Set description to show the app DX ID
      treeItem.description = element.dxid;
      
      // Create a rich tooltip with key app information
      const app = element.jsonData;
      treeItem.tooltip = new vscode.MarkdownString(`
### App Details
- **Name:** ${app.name}
- **Title:** ${app.title}
- **ID:** ${app.id}
- **DX ID:** ${app.dxid}
- **Created by:** ${app.addedByFullname || app.addedBy}
- **Created at:** ${app.createdAt}
- **Revision:** ${app.revision}
- **Scope:** ${app.scope}
- **Location:** ${app.location}
      `);
      
      // Set context value for menu contributions
      treeItem.contextValue = 'app';
      
      // Set icon path
      treeItem.iconPath = {
        light: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'light', 'app.svg'))),
        dark: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'dark', 'app.svg')))
      };
      
      return treeItem;
    } else {
      // Create a template node
      const treeItem = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      
      // Set description to show instance type from the template
      if (element.templateData && element.templateData.inputs && element.templateData.inputs.length > 0) {
        treeItem.description = element.templateData.inputs[0].instanceType.label || '';
      }
      
      // Create a tooltip with template details
      if (element.templateData) {
        const template = element.templateData;
        treeItem.tooltip = new vscode.MarkdownString(`
### Template Details
- **Job Name:** ${template.jobName}
- **Job Limit:** ${template.jobLimit}
- **Scope:** ${template.scope.label}
- **Instance Type:** ${template.inputs[0]?.instanceType.label || 'Not specified'}
        `);
      }
      
      // Set context value for menu contributions
      treeItem.contextValue = 'template';
      
      // Set icon path
      treeItem.iconPath = {
        light: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'light', 'zap.svg'))),
        dark: vscode.Uri.file(this.context.asAbsolutePath(path.join('resources', 'dark', 'zap.svg')))
      };
      
      // Set command to edit the template when clicked
      treeItem.command = {
        command: 'pfdaAppExplorer.editTemplate',
        title: 'Edit Template',
        arguments: [element]
      };
      
      return treeItem;
    }
  }

  getChildren(element?: PfdaAppNode): Thenable<PfdaAppNode[]> {
    if (element) {
      // If an app node is selected, return its template children
      if (element.type === PfdaAppNodeType.App) {
        console.log(`Loading templates for app ${element.dxid}`);
        const templates = PfdaAppNode.loadTemplates(this.rootPath, element);
        console.log(`Found ${templates.length} templates for app ${element.dxid}`);
        return Promise.resolve(templates);
      }
      // Template nodes have no children
      return Promise.resolve([]);
    }

    // Return top-level app nodes
    return Promise.resolve(this.appNodes);
  }

  // Update the view with the new active space ID
  updateActiveSpace(spaceId: string): void {
    console.log(`PfdaAppExplorer: Updating active space to ${spaceId}`);
    this.activeSpaceId = spaceId;
    this.refresh();
  }

  // Refresh the app list
  async refresh(): Promise<void> {
    try {
      await this.loadApps();
      this._onDidChangeTreeData.fire();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to refresh apps: ${error}`);
    }
  }

  // Load apps from PFDA CLI
  private async loadApps(): Promise<void> {
    // Clear current apps
    this.appNodes = [];
    
    try {
      // Call PFDA CLI to list apps
      let args = ['ls-apps'];
      
      // Handle the special "My Home" space and regular spaces differently
      if (this.activeSpaceId === 'my-home') {
        console.log(`PfdaAppExplorer: Listing apps for My Home (no space-id parameter)`);
        // Don't add space-id parameter for My Home
      } else if (this.activeSpaceId) {
        console.log(`PfdaAppExplorer: Listing apps for space ID: ${this.activeSpaceId}`);
        args = args.concat(['-space-id', this.activeSpaceId]);
      } else {
        console.log('PfdaAppExplorer: No active space, defaulting to My Home');
        // If no space is selected, don't add a space-id parameter (My Home behavior)
      }
      
      const result = await this.pfdaCli.callPfdaCli(args);
      
      if (result && Array.isArray(result)) {
        // Parse app data from the API response
        this.appNodes = result.map(app => {
          return new PfdaAppNode(
            app.id.toString(),
            app.title || app.name || `App-${app.id}`,
            app.dxid || '',
            app,
            PfdaAppNodeType.App
          );
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load apps: ${error}`);
    }
  }

  // Open an app in a text editor
  private async openApp(node: PfdaAppNode): Promise<void> {
    try {
      // Create the tmp/apps directory if it doesn't exist
      const appDir = PfdaAppNode.getAppDirectoryPath(this.rootPath, node.dxid);
      
      // Create a filename based on the app name or ID
      const sanitizedName = node.label.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${sanitizedName}_${node.id}.json`;
      const filePath = path.join(appDir, fileName);
      
      // Write the app JSON to the file
      fs.writeFileSync(filePath, JSON.stringify(node.jsonData, null, 2), 'utf8');
      
      // Open the file in a text editor
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open app: ${error}`);
    }
  }

  // Create a new template for an app
  private async createTemplate(node: PfdaAppNode): Promise<void> {
    try {
      if (node.type !== PfdaAppNodeType.App) {
        throw new Error('Cannot create template for non-app node');
      }
      
      console.log(`Creating template for app ${node.dxid}`);
      
      // Create a default template
      const defaultTemplate: AppRunTemplate = {
        jobName: "code-server",
        jobLimit: "5",
        output_folder_path: "",
        scope: {
          label: this.activeSpaceId ? `${this.activeSpaceId}` : "In_Progress_Space (Group)",
          value: this.activeSpaceId || ""
        },
        inputs: [
          {
            id: 1,
            fields: {
              snapshot: "",
              path_to_executable: "/home/dnanexus/start.sh"
            },
            instanceType: {
              value: "baseline-2",
              label: "Baseline 2    0.286$/hour"
            }
          }
        ]
      };
      
      // Save the template
      const templateNode = await PfdaAppNode.saveTemplate(this.rootPath, node, defaultTemplate);
      if (templateNode) {
        console.log(`Template saved successfully: ${templateNode.id}`);
        
        // Refresh only the specific app node to show the new template
        this._onDidChangeTreeData.fire(node);
        
        // Give the UI time to update before opening the editor
        setTimeout(() => {
          // Open the template for editing
          this.editTemplate(templateNode);
        }, 500);
      } else {
        throw new Error('Failed to create template node');
      }
    } catch (error) {
      console.error('Error creating template:', error);
      vscode.window.showErrorMessage(`Failed to create template: ${error}`);
    }
  }

  // Edit an existing template
  private async editTemplate(node: PfdaAppNode): Promise<void> {
    try {
      if (node.type !== PfdaAppNodeType.Template || !node.parent) {
        throw new Error('Invalid template node');
      }
      
      console.log(`Editing template ${node.id} for app ${node.dxid}`);
      
      // Get the app directory
      const appDir = PfdaAppNode.getAppDirectoryPath(this.rootPath, node.dxid);
      
      // Create the template file path
      const filePath = path.join(appDir, `${node.id}.json`);
      
      // Check if the file exists
      if (!fs.existsSync(filePath)) {
        console.error(`Template file not found: ${filePath}`);
        vscode.window.showErrorMessage(`Template file not found: ${filePath}`);
        return;
      }
      
      // Open the file in a text editor
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      console.error('Error editing template:', error);
      vscode.window.showErrorMessage(`Failed to edit template: ${error}`);
    }
  }

  // Delete a template
  private async deleteTemplate(node: PfdaAppNode): Promise<void> {
    try {
      if (node.type !== PfdaAppNodeType.Template || !node.parent) {
        throw new Error('Invalid template node');
      }
      
      console.log(`Deleting template ${node.id} for app ${node.dxid}`);
      
      // Confirm deletion
      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete the template "${node.label}"?`,
        { modal: true },
        'Delete',
        'Cancel'
      );
      
      if (confirm !== 'Delete') {
        return;
      }
      
      // Get the app directory
      const appDir = PfdaAppNode.getAppDirectoryPath(this.rootPath, node.dxid);
      
      // Create the template file path
      const filePath = path.join(appDir, `${node.id}.json`);
      
      // Delete the file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Template file deleted: ${filePath}`);
      } else {
        console.warn(`Template file not found for deletion: ${filePath}`);
      }
      
      // Store the parent node for refreshing
      const parentNode = node.parent;
      
      // Refresh the view - specifically the parent node to update its children
      this._onDidChangeTreeData.fire(parentNode);
    } catch (error) {
      console.error('Error deleting template:', error);
      vscode.window.showErrorMessage(`Failed to delete template: ${error}`);
    }
  }

  // Run a template (mock API call)
  private async runTemplate(node: PfdaAppNode): Promise<void> {
    try {
      if (node.type !== PfdaAppNodeType.Template || !node.templateData) {
        throw new Error('Invalid template node');
      }
      
      console.log(`Running template ${node.id} for app ${node.dxid}`);
      
      // Show progress notification
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Running template: ${node.label}`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: "Preparing to run template..." });
        
        // Mock API call delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        progress.report({ increment: 30, message: "Sending request to server..." });
        
        // Mock API call
        await this.mockApiCall(node.templateData!);
        
        progress.report({ increment: 70, message: "Processing complete!" });
        
        // Small delay to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
      });
      
      // Show success message
      vscode.window.showInformationMessage(`Successfully started job: ${node.label}`);
      
    } catch (error) {
      console.error('Error running template:', error);
      vscode.window.showErrorMessage(`Failed to run template: ${error}`);
    }
  }
  
  // Mock API call to external service
  private async mockApiCall(templateData: AppRunTemplate): Promise<any> {
    console.log('Making mock API call with template data:', JSON.stringify(templateData, null, 2));
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Mock successful response
    return {
      success: true,
      job_id: `job-${Date.now()}`,
      execution_id: `execution-${Math.random().toString(36).substring(2, 10)}`,
      status: 'running',
      message: 'Job started successfully'
    };
  }

  // Clean up resources when disposing
  dispose(): void {
    // Dispose all registered disposables
    this.disposables.forEach(d => d.dispose());
  }
}
