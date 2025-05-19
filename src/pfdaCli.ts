import { spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { pfdaStatusBarItem } from './extension';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const execAsync = promisify(require('child_process').exec);

export class PfdaCli {
  private cliPath: string;
  private defaultParams: string;

  constructor(workspacePath: string, defaultParams = '-skipverify true') {
    this.cliPath = PfdaCli.findPfdaCliPath(workspacePath);
    this.defaultParams = defaultParams;
  }

  public getDefaultParams(): string {
    return this.defaultParams;
  }

  public getCliPath(): string {
    return this.cliPath;
  }

  public async executeCommand(command: string): Promise<{ stdout: string, stderr: string }> {
    try {
      const result = await execAsync(command);
      return result;
    } catch (error: any) {
      const message = error.stderr ? error.stderr : error.message;
      throw new Error(message);
    }
  }

  public async callPfdaCli(args: string[], options: { input?: string } = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!args.includes('-json')) {
        args.push('-json');
      }
      const cli = this.cliPath;
      
      const proc = spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { 
        const output = data.toString();
        stdout += output; 
        // console.log(`PfdaCli: Command stdout: ${output}`);
      });
      
      proc.stderr.on('data', (data) => { 
        const output = data.toString();
        stderr += output; 
        console.error(`PfdaCli: Command stderr: ${output}`);
      });
      
      proc.on('error', (err) => {
        console.error(`PfdaCli: Command spawn error: ${err.message}`);
        reject(err);
      });
      
      proc.on('close', (code) => {
        if (code !== 0) {
          console.error(`PfdaCli: Command failed with code ${code}: ${stderr}`);
          reject(new Error(stderr || `pfda exited with code ${code}`));
        } else {
          try {
            // console.log(`PfdaCli: Command succeeded with raw output: ${stdout}`);
            const result = JSON.parse(stdout);
            // console.log(`PfdaCli: Command succeeded with parsed result: ${JSON.stringify(result)}`);
            resolve(result);
          } catch (parseError) {
            console.error(`PfdaCli: Failed to parse JSON output: ${stdout}`);
            console.error(`PfdaCli: Parse error details: ${parseError}`);
            reject(new Error('Failed to parse pfda JSON output: ' + stdout));
          }
        }
      });
      
      if (options.input) {
        proc.stdin.write(options.input);
        proc.stdin.end();
      }
    });
  }

  /**
   * Upload files to PFDA with progress tracking
   * @param filePaths Array of file paths to upload
   * @param spaceId The space ID to upload to (optional)
   * @param folderId The folder ID to upload to (optional)
   * @param options Additional upload options like threads and chunksize
   * @returns A promise that resolves when the upload is complete
   */
  public async uploadFiles(
    filePaths: string[], 
    spaceId?: string, 
    folderId?: string, 
    options?: { threads?: number; chunksize?: number }
  ): Promise<void> {
    console.log(`PfdaCli: Starting uploadFiles with paths=${JSON.stringify(filePaths)}, spaceId=${spaceId}, folderId=${folderId}`);
    // Create progress window
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Uploading ${filePaths.length} file(s)`,
      cancellable: true
    }, async (progress, token) => {
      // Get filesystem stats to check for directories
      const fileStats = await Promise.all(filePaths.map(async (filePath) => {
        try {
          const stats = await fs.promises.stat(filePath);
          return { 
            path: filePath, 
            isDirectory: stats.isDirectory(),
            size: stats.size
          };
        } catch (e) {
          console.error(`Error getting stats for ${filePath}:`, e);
          return { path: filePath, isDirectory: false, size: 0 };
        }
      }));
      
      console.log(`PfdaCli: File stats: ${JSON.stringify(fileStats)}`);
      
      // Count total files (including nested ones in directories)
      let totalFiles = 0;
      
      // Recursively count files in directories
      const countFilesInDirectory = async (dirPath: string): Promise<number> => {
        let fileCount = 0;
        
        try {
          const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
              const filesInDir = await countFilesInDirectory(fullPath);
              fileCount += filesInDir;
            } else {
              fileCount++;
            }
          }
        } catch (e) {
          console.error(`Error counting files in ${dirPath}:`, e);
        }
        
        return fileCount;
      };
      
      // Count all files
      for (const file of fileStats) {
        if (file.isDirectory) {
          const filesInDir = await countFilesInDirectory(file.path);
          totalFiles += filesInDir;
        } else {
          totalFiles++;
        }
      }
      
      console.log(`PfdaCli: Total files to upload: ${totalFiles}`);
      
      // If no files found, exit early
      if (totalFiles === 0) {
        console.log(`PfdaCli: No files found to upload`);
        vscode.window.showWarningMessage('No files found to upload.');
        return;
      }
      
      // Update status bar to show upload in progress
      pfdaStatusBarItem.text = `$(cloud-upload) PFDA: Uploading 0/${totalFiles} files`;
      pfdaStatusBarItem.tooltip = `Uploading ${totalFiles} file(s)`;
      
      // Setup args array starting with the command
      const args = ['upload-file'];

      // Add each file path as a separate argument at the end
      filePaths.forEach(filePath => {
        args.push(filePath);
      });
      
      // Add space-id if provided (not for "my-home")
      if (spaceId && spaceId !== 'my-home') {
        console.log(`PfdaCli: Adding space-id ${spaceId} to upload command`);
        args.push('-space-id', spaceId);
      } else {
        console.log(`PfdaCli: No space-id added to upload command (spaceId=${spaceId})`);
      }
      
      // Add folder-id if provided
      if (folderId) {
        console.log(`PfdaCli: Adding folder-id ${folderId} to upload command`);
        args.push('-folder-id', folderId);
      } else {
        console.log(`PfdaCli: No folder-id provided for upload command`);
      }
      
      // Add threads if provided
      if (options?.threads) {
        console.log(`PfdaCli: Setting threads to ${options.threads}`);
        args.push('-threads', options.threads.toString());
      }
      
      // Add chunksize if provided
      if (options?.chunksize) {
        console.log(`PfdaCli: Setting chunksize to ${options.chunksize}`);
        args.push('-chunksize', options.chunksize.toString());
      }
      
      // Create cancellation token
      const cancelTokenSource = new vscode.CancellationTokenSource();
      token.onCancellationRequested(() => {
        cancelTokenSource.cancel();
      });
      
      return new Promise<void>((resolve, reject) => {
        console.log(`PfdaCli: Executing upload command: ${this.cliPath} ${args.join(' ')}`);
        
        // Update status bar to show upload in progress
        pfdaStatusBarItem.text = '$(cloud-upload) PFDA: Uploading...';
        pfdaStatusBarItem.tooltip = `Uploading ${filePaths.length} file(s)`;
        
        const proc = spawn(this.cliPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        console.log(`PfdaCli: Spawned upload process with PID ${proc.pid}`);
        
        // Variables to store process output
        let stderr = '';
        let lastProgressUpdate = 0;
        let filesProcessed = 0;
        
        proc.stdout.on('data', (data) => { 
          // Extract progress information if available
          const output = data.toString();

          console.log(`PfdaCli: Upload process output: ${output}`);
          
          // Look for file completion markers
          const fileCompletedLines = output.split('\n').filter((line: string) => 
            line.includes('successfully uploaded') || 
            line.includes('Uploaded file'));
          
          if (fileCompletedLines.length > 0) {
            filesProcessed += fileCompletedLines.length;
            const progressPercent = Math.min(Math.round((filesProcessed / totalFiles) * 100), 100);
            
            // Update progress notification
            progress.report({ 
              message: `${progressPercent}% complete (${filesProcessed}/${totalFiles} files)`, 
              increment: progressPercent - lastProgressUpdate 
            });
            
            // Update status bar
            pfdaStatusBarItem.text = `$(cloud-upload) PFDA: ${filesProcessed}/${totalFiles} files`;
            lastProgressUpdate = progressPercent;
          }
          
          // Also check for percentage-based progress for individual large files
          const progressLines = output.split('\n').filter((line: string) => line.includes('Progress:'));
          
          if (progressLines.length > 0) {
            const latestProgress = progressLines[progressLines.length - 1];
            const match = latestProgress.match(/Progress:\s*(\d+)%/);
            if (match && match[1]) {
              const progressPercentage = parseInt(match[1], 10);
              // Only update status bar with file progress
              if (progressPercentage - lastProgressUpdate >= 5 || progressPercentage === 100) {
                pfdaStatusBarItem.text = `$(cloud-upload) PFDA: ${filesProcessed}/${totalFiles} files (current: ${progressPercentage}%)`;
              }
            }
          }
        });
        
        proc.stderr.on('data', (data) => { 
          stderr += data.toString();
          console.error(`PfdaCli Upload Error: ${data.toString()}`);
        });
        
        proc.on('error', (err) => {
          console.error(`PfdaCli Upload Process Error: ${err.message}`);
          reject(err);
        });
        
        proc.on('close', (code) => {
          // Reset status bar
          pfdaStatusBarItem.text = '$(cloud) PFDA';
          pfdaStatusBarItem.tooltip = 'PFDA Services Status';
          console.log(code);
          
          if (code !== 0) {
            console.error(`PfdaCli: Upload command failed with code ${code}: ${stderr}`);
            reject(new Error(stderr || `pfda upload exited with code ${code}`));
          } else {
            console.log(`PfdaCli: Upload command succeeded`);
            resolve();
          }
        });
      });
    });
  }


  public static findPfdaCliPath(workspacePath: string): string {
    const possiblePaths = [
      path.join(workspacePath, 'pfda')
    ];
    for (const cliPath of possiblePaths) {
      if (fs.existsSync(cliPath)) {
        return cliPath;
      }
    }
    throw new Error(`PFDA CLI not found in expected locations. Please install the pfda CLI or configure its path.\n ${path.join(workspacePath, 'packages', 'cli', 'pfda')}`);
  }


  /**
   * Recursively delete a remote PFDA directory
   * This method is intended for remote directories in PFDA, not local filesystem directories
   * 
   * @param directoryId The ID of the directory to delete
   * @param options Options for the deletion process including space ID and progress display
   * @returns A promise that resolves when deletion is complete
   */
  public async deleteRemoteDirectory(
    directoryId: string,
    options: { 
      spaceId?: string;
      showProgress?: boolean;
    } = { showProgress: true }
  ): Promise<void> {
    console.log(`PfdaCli: Starting remote directory deletion for ID ${directoryId}`);
    
    // If showing progress, wrap in a progress notification
    if (options.showProgress) {
      return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deleting directory`,
        cancellable: true
      }, async (progress, token) => {
        return this._deleteRemoteDirectoryInternal(directoryId, options.spaceId, progress, token);
      });
    } else {
      // Otherwise just call the internal method directly
      return this._deleteRemoteDirectoryInternal(directoryId, options.spaceId);
    }
  }

  /**
   * Internal implementation of recursive remote directory deletion
   * 
   * @param directoryId The ID of the directory to delete
   * @param spaceId Optional space ID if deleting from a specific space
   * @param progress Optional progress object for reporting progress
   * @param token Optional cancellation token
   * @returns A promise that resolves when deletion is complete
   */
  private async _deleteRemoteDirectoryInternal(
    directoryId: string,
    spaceId?: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    token?: vscode.CancellationToken
  ): Promise<void> {
    try {
      console.log(`PfdaCli: Starting _deleteRemoteDirectoryInternal for directory ID ${directoryId}`);
      
      // Try the rmdir command with -recursive flag first (most efficient if supported)
      const rmdirArgs = ['rmdir', directoryId, '-recursive'];
      if (spaceId && spaceId !== 'my-home') {
        rmdirArgs.push('-space-id', spaceId);
      }
      
      // Manual approach: List contents, delete files, recursively delete subdirectories
      // List all items in the directory
      const lsArgs = ['ls', '-folder-id', directoryId, '-json'];
      if (spaceId && spaceId !== 'my-home') {
        lsArgs.push('-space-id', spaceId);
      }
      
      console.log(`PfdaCli: Listing directory contents with: ${lsArgs.join(' ')}`);
      const result = await this.callPfdaCli(lsArgs);
      
      // Handle different response formats
      let items: any[] = [];
      if (Array.isArray(result)) {
        items = result;
      } else if (result.files && Array.isArray(result.files)) {
        items = result.files;
      } else if (typeof result === 'object') {
        // Try to extract items from the response object
        items = Object.values(result).filter(item => typeof item === 'object');
      }
      
      console.log(`PfdaCli: Found ${items.length} items in directory`);
      
      let processedCount = 0;
      const totalItems = items.length;
      
      // Process each item in the directory
      for (const item of items) {
        // Check for cancellation
        if (token?.isCancellationRequested) {
          console.log(`PfdaCli: Directory deletion was cancelled during processing`);
          return;
        }
        
        // For files, use uid (format: "file-XXXXX"); for folders, use id (numeric)
        const itemId = item.type === "Folder" ? item.id : item.uid;
        const itemName = item.name || item.path?.split('/').pop() || "Unknown";
        const isDirectory = item.type === "Folder";
        
        console.log(`PfdaCli: Processing item ${itemName}, isDirectory=${isDirectory}, ID=${itemId}`);
        
        if (isDirectory) {
          // Recursively delete subdirectory
          console.log(`PfdaCli: Recursively deleting subdirectory ${itemName}`);
          await this._deleteRemoteDirectoryInternal(String(itemId), spaceId, progress, token);
        } else {
          // Delete file
          console.log(`PfdaCli: Deleting file ${itemName} with ID ${itemId}`);
          const rmArgs = ['rm', String(itemId)];
          if (spaceId && spaceId !== 'my-home') {
            rmArgs.push('-space-id', spaceId);
          }
          
          try {
            await this.callPfdaCli(rmArgs);
            console.log(`PfdaCli: Successfully deleted file ${itemName}`);
          } catch (fileError) {
            console.error(`PfdaCli: Error deleting file ${itemName}:`, fileError);
            // Try an alternative approach if the first one fails
            try {
              console.log(`PfdaCli: Trying alternative deletion for file ${itemName}`);
              // If using uid failed, try using the numeric ID (if available)
              if (item.id && itemId !== item.id) {
                const altRmArgs = ['rm', String(item.id)];
                if (spaceId && spaceId !== 'my-home') {
                  altRmArgs.push('-space-id', spaceId);
                }
                await this.callPfdaCli(altRmArgs);
                console.log(`PfdaCli: Successfully deleted file ${itemName} using alternative ID`);
              } else {
                throw fileError; // Re-throw if no alternative ID available
              }
            } catch (altError) {
              console.error(`PfdaCli: Alternative deletion also failed for ${itemName}:`, altError);
              throw fileError; // Throw the original error
            }
          }
        }
        
        // Update progress
        processedCount++;
        if (progress) {
          const progressPercent = Math.round((processedCount / totalItems) * 100);
          progress.report({
            message: `Deleted ${processedCount}/${totalItems} items (${progressPercent}%)`,
            increment: 100 / totalItems
          });
        }
      }
      
      // All contents deleted, now remove the directory itself
      console.log(`PfdaCli: All contents deleted, now removing empty directory ${directoryId}`);
      const simpleRmdirArgs = ['rmdir', directoryId];
      if (spaceId && spaceId !== 'my-home') {
        simpleRmdirArgs.push('-space-id', spaceId);
      }
      
      try {
        await this.callPfdaCli(simpleRmdirArgs);
        console.log(`PfdaCli: Successfully removed empty directory`);
      } catch (rmdirError) {
        console.error(`PfdaCli: Error removing directory:`, rmdirError);
        throw rmdirError;
      }
      
    } catch (error) {
      console.error(`PfdaCli: Error in _deleteRemoteDirectoryInternal:`, error);
      console.error(`PfdaCli: Stack trace:`, error instanceof Error ? error.stack : 'No stack trace available');
      throw new Error(`Failed to delete directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
