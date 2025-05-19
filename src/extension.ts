import * as vscode from 'vscode';

import { DepNodeProvider, Dependency } from './nodeDependencies';
import { PfdaFileExplorer } from './pfdaFileExplorer';
import { SpaceSelector } from './spaceSelector';
import { PfdaExecutionExplorer } from './pfdaExecutionExplorer';
import { PfdaAppExplorer } from './pfdaAppExplorer';

// Create a shared status bar item for PFDA operations
export const pfdaStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

export function activate(context: vscode.ExtensionContext) {
	const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
		? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

	// Initialize status bar item
	pfdaStatusBarItem.text = '$(cloud) PFDA';
	pfdaStatusBarItem.tooltip = 'PFDA Services Status';
	pfdaStatusBarItem.show();
	context.subscriptions.push(pfdaStatusBarItem);

	// Samples of `window.registerTreeDataProvider`
	const nodeDependenciesProvider = new DepNodeProvider(rootPath);
	vscode.window.registerTreeDataProvider('nodeDependencies', nodeDependenciesProvider);
	vscode.commands.registerCommand('nodeDependencies.refreshEntry', () => nodeDependenciesProvider.refresh());
	vscode.commands.registerCommand('extension.openPackageOnNpm', moduleName => vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`https://www.npmjs.com/package/${moduleName}`)));
	vscode.commands.registerCommand('nodeDependencies.addEntry', () => vscode.window.showInformationMessage(`Successfully called add entry.`));
	vscode.commands.registerCommand('nodeDependencies.editEntry', (node: Dependency) => vscode.window.showInformationMessage(`Successfully called edit entry on ${node.label}.`));
	vscode.commands.registerCommand('nodeDependencies.deleteEntry', (node: Dependency) => vscode.window.showInformationMessage(`Successfully called delete entry on ${node.label}.`));
	
	// Initialize PFDA file explorer
	new PfdaFileExplorer(context);
	
	// Initialize Space Selector
	const spaceSelector = new SpaceSelector(context);
	context.subscriptions.push(spaceSelector);
	
	// Initialize Execution Explorer
	const executionExplorer = new PfdaExecutionExplorer(context);
	context.subscriptions.push(executionExplorer);
	
	// Initialize App Explorer
	const appExplorer = new PfdaAppExplorer(context);
	context.subscriptions.push(appExplorer);
	// Register space selection event handler to update execution explorer and app explorer
	vscode.commands.registerCommand('spaceSelector.spaceSelected', (spaceId: string) => {
		executionExplorer.updateActiveSpace(spaceId);
		appExplorer.updateActiveSpace(spaceId);
	});
}