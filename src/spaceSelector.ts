import * as vscode from 'vscode';
import { PfdaCli } from './pfdaCli';

export interface SpaceNode {
  id: string;
  label: string;
  description?: string;
  isActive: boolean;
  iconPath?: vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
}

export class SpaceSelector implements vscode.TreeDataProvider<SpaceNode>, vscode.Disposable {
  private _onDidChangeTreeData: vscode.EventEmitter<SpaceNode | undefined | null | void> = new vscode.EventEmitter<SpaceNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SpaceNode | undefined | null | void> = this._onDidChangeTreeData.event;

  private spaces: SpaceNode[] = [];
  private activeSpace: string | undefined;
  private pfdaCli: PfdaCli;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!rootPath) {
      throw new Error('No workspace folder is open');
    }
    
    // Initialize PfdaCli instance
    this.pfdaCli = new PfdaCli(rootPath);

    // Restore saved active space if available
    const savedSpace = this.context.workspaceState.get<string>('activeSpaceId');
    if (savedSpace) {
      this.activeSpace = savedSpace;
    }
    
    // Register view
    const view = vscode.window.createTreeView('spaceSelector', { 
      treeDataProvider: this, 
      showCollapseAll: true 
    });
    
    // Register commands
    this.disposables.push(view);
    this.disposables.push(vscode.commands.registerCommand('spaceSelector.refresh', () => this.refresh()));
    this.disposables.push(vscode.commands.registerCommand('spaceSelector.selectSpace', (node: SpaceNode) => this.selectSpace(node)));
    this.disposables.push(vscode.commands.registerCommand('spaceSelector.addSpace', () => this.addSpace()));
    
    // Initialize and load spaces
    this.initialize();
  }
  
  dispose(): void {
    // Dispose all registered disposables
    this.disposables.forEach(d => d.dispose());
  }
  
  /**
   * Initialize the space selector and load spaces
   */
  private async initialize(): Promise<void> {
    console.log('SpaceSelector: Initializing');
    
    setTimeout(async () => {
      try {
        console.log('SpaceSelector: Loading spaces');
        await this.loadSpaces();
        console.log(`SpaceSelector: Spaces loaded, found ${this.spaces.length} spaces`);
        this._onDidChangeTreeData.fire();
        
        // Automatically select "My Home" space on startup if no space is selected
        if (this.activeSpace === 'my-home') {
          // Notify file explorer and execution explorer to use the My Home space
          console.log('SpaceSelector: Auto-selecting My Home space on startup');
          vscode.commands.executeCommand('pfdaFileExplorer.refresh', this.activeSpace);
          vscode.commands.executeCommand('spaceSelector.spaceSelected', this.activeSpace);
        }
      } catch (error) {
        console.error('Error initializing space selector:', error);
      }
    }, 1000); // Small delay to ensure the view is ready
  }

  refresh(): void {
    // Trigger refresh with progress indication
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'Refreshing spaces...',
      cancellable: false
    }, async () => {
      await this.loadSpaces();
      this._onDidChangeTreeData.fire();
      return Promise.resolve();
    });
  }

  getTreeItem(element: SpaceNode): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    
    treeItem.id = element.id;
    treeItem.description = element.description;
    treeItem.contextValue = element.isActive ? 'activeSpace' : 'space';
    
    // Use folder icon for spaces
    treeItem.iconPath = element.id === 'my-home' 
      ? {
          light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'light', 'home.svg'),
          dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dark', 'home.svg')
        }
      : {
          light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'light', 'space.svg'),
          dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dark', 'space.svg')
        };

    treeItem.command = {
      command: 'spaceSelector.selectSpace',
      title: 'Select Space',
      arguments: [element]
    };
    
    return treeItem;
  }

  getChildren(element?: SpaceNode): SpaceNode[] | Thenable<SpaceNode[]> {
    if (element) {
      return []; // No child items for spaces
    }
    
    // If spaces array is empty, try loading it
    if (this.spaces.length === 0) {
      return this.loadSpacesAndReturn();
    }
    
    return this.spaces;
  }
  
  /**
   * Load spaces and return them for the tree view
   */
  private async loadSpacesAndReturn(): Promise<SpaceNode[]> {
    try {
      await this.loadSpaces();
      return this.spaces;
    } catch (error) {
      console.error('Error loading spaces:', error);
      return [];
    }
  }

  // Load spaces from the PFDA CLI
  private async loadSpaces(): Promise<void> {
    console.log('SpaceSelector: Starting to load spaces from PFDA CLI');
    try {
      // Get spaces from the PFDA CLI using the ls-spaces command
      console.log('SpaceSelector: Calling ls-spaces command');
      const result = await this.pfdaCli.callPfdaCli(['ls-spaces', '-skipverify', 'true']);
      console.log('SpaceSelector: Received result from ls-spaces:', result);
      
      if (!result || !Array.isArray(result)) {
        console.warn('SpaceSelector: Invalid result from ls-spaces command:', result);
        this.spaces = [];
        return;
      }
      
      // Create a "My Home" space node to add at the top of the list
      const myHomeNode: SpaceNode = {
        id: 'my-home',
        label: 'My Home',
        description: 'Default Home Space',
        isActive: this.activeSpace === 'my-home' || this.activeSpace === undefined
      };
      
      console.log('SpaceSelector: Created My Home space node:', myHomeNode);
      
      // Transform result into SpaceNode objects
      const otherSpaces = result.map((space: any) => {
        // Make sure ID is a string
        const id = typeof space.id === 'number' ? space.id.toString() : space.id;
        
        const node = {
          id: id,
          label: space.title || space.name || `Space ${id}`,
          description: `${space.type || ''} (${space.role || 'member'})`,
          isActive: id === this.activeSpace
        };
        
        console.log('SpaceSelector: Created space node:', node);
        return node;
      });
      
      // Add My Home at the top of the spaces list
      this.spaces = [myHomeNode, ...otherSpaces];
      
      // If no active space is set, set "My Home" as active
      if (!this.activeSpace) {
        this.activeSpace = 'my-home';
        console.log('SpaceSelector: Setting My Home as default active space');
      }
      
      console.log(`SpaceSelector: Loaded ${this.spaces.length} spaces (including My Home)`);
    } catch (error) {
      console.error('SpaceSelector: Failed to load spaces:', error);
      vscode.window.showErrorMessage(`Failed to load spaces: ${error}`);
      this.spaces = [];
    }
  }

  // Select a space and update the file explorer
  private async selectSpace(node: SpaceNode): Promise<void> {
    try {
      // Don't do anything if the space is already active
      if (node.isActive) {
        console.log(`SpaceSelector: Space ${node.id} (${node.label}) is already active`);
        return;
      }
      
      console.log(`SpaceSelector: Selecting space ${node.id} (${node.label})`);
      
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Switching to space: ${node.label}`,
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Updating space...' });
        
        // Update the active space locally - no need to call set-space as it doesn't exist
        this.activeSpace = node.id.toString();
        console.log(`SpaceSelector: Set active space to ${this.activeSpace} (type: ${typeof this.activeSpace})`);
        
        this.spaces.forEach(space => {
          space.isActive = space.id === this.activeSpace;
        });
        
        this._onDidChangeTreeData.fire();
        
        // Save the active space in workspace state
        this.context.workspaceState.update('activeSpaceId', this.activeSpace);
        
        // Refresh the file explorer view to show files from the selected space
        // Pass the space ID to the file explorer refresh command
        console.log(`SpaceSelector: Refreshing file explorer with space ID: ${this.activeSpace}`);
        vscode.commands.executeCommand('pfdaFileExplorer.refresh', this.activeSpace);
        
        // Also notify the execution explorer about the space change
        console.log(`SpaceSelector: Notifying execution explorer about space change: ${this.activeSpace}`);
        vscode.commands.executeCommand('spaceSelector.spaceSelected', this.activeSpace);
        
        return Promise.resolve();
      });
    } catch (error: any) {
      console.error('SpaceSelector: Failed to select space:', error);
      vscode.window.showErrorMessage(`Failed to select space: ${error}`);
    }
  }

  // Add a new space
  private async addSpace(): Promise<void> {
    const spaceName = await vscode.window.showInputBox({
      prompt: 'Enter the name for the new space',
      placeHolder: 'Space name'
    });
    
    if (!spaceName) {
      return;
    }
    
    try {
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Creating new space: ${spaceName}`,
        cancellable: false
      }, async (progress: any) => {
        progress.report({ message: 'Contacting PFDA service...' });
        
        // Use the PFDA CLI to create a new space
        await this.pfdaCli.callPfdaCli(['create-space', spaceName, '-skipverify', 'true']);
        
        // Refresh the spaces list
        this.refresh();
        vscode.window.showInformationMessage(`Created new space: ${spaceName}`);
        
        return Promise.resolve();
      });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create space: ${error}`);
    }
  }
}
