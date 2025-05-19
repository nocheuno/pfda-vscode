import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export enum PfdaAppNodeType {
  App = 'app',
  Template = 'template'
}

export interface AppRunTemplate {
  jobName: string;
  jobLimit: string;
  output_folder_path: string;
  scope: {
    label: string;
    value: string;
  };
  inputs: {
    id: number;
    fields: {
      snapshot: string;
      path_to_executable: string;
    };
    instanceType: {
      value: string;
      label: string;
    };
  }[];
}

export class PfdaAppNode {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly dxid: string,
    readonly jsonData: any,
    readonly type: PfdaAppNodeType = PfdaAppNodeType.App,
    readonly parent?: PfdaAppNode,
    readonly templateData?: AppRunTemplate
  ) {}

  // Get the app directory path for storing templates
  public static getAppDirectoryPath(rootPath: string, dxid: string): string {
    const appDir = path.join(rootPath, 'tmp', 'apps', dxid);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
    return appDir;
  }

  // Load templates for an app
  public static loadTemplates(rootPath: string, parentNode: PfdaAppNode): PfdaAppNode[] {
    try {
      const appDir = PfdaAppNode.getAppDirectoryPath(rootPath, parentNode.dxid);
      const templates: PfdaAppNode[] = [];
      
      if (fs.existsSync(appDir)) {
        const files = fs.readdirSync(appDir);
        
        // Filter out app JSON files (we only want template files)
        const templateFiles = files.filter(file => {
          return file.endsWith('.json') && file.startsWith('template-');
        });
        
        console.log(`Found ${templateFiles.length} template files for app ${parentNode.dxid}`);
        
        for (const file of templateFiles) {
          try {
            const filePath = path.join(appDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            let templateData: AppRunTemplate;
            
            try {
              templateData = JSON.parse(content) as AppRunTemplate;
              
              // Validate that the parsed data has the expected structure
              if (!templateData.jobName || !templateData.inputs || !Array.isArray(templateData.inputs)) {
                console.warn(`Template file ${file} has invalid structure, skipping.`);
                continue;
              }
              
              templates.push(new PfdaAppNode(
                file.replace('.json', ''),
                templateData.jobName || 'Unnamed Template',
                parentNode.dxid,
                parentNode.jsonData,
                PfdaAppNodeType.Template,
                parentNode,
                templateData
              ));
              
              console.log(`Loaded template: ${templateData.jobName} (${file})`);
            } catch (parseErr) {
              console.error(`Error parsing template JSON ${file}:`, parseErr);
              // Skip invalid JSON files
              continue;
            }
          } catch (readErr) {
            console.error(`Error reading template file ${file}:`, readErr);
          }
        }
      } else {
        console.log(`App directory does not exist for ${parentNode.dxid}, creating it`);
      }
      
      return templates;
    } catch (err) {
      console.error(`Error loading templates for app ${parentNode.dxid}:`, err);
      vscode.window.showErrorMessage(`Failed to load templates: ${err}`);
      return [];
    }
  }

  // Save a new template for an app
  public static async saveTemplate(rootPath: string, parentNode: PfdaAppNode, templateData: AppRunTemplate): Promise<PfdaAppNode | undefined> {
    try {
      const appDir = PfdaAppNode.getAppDirectoryPath(rootPath, parentNode.dxid);
      
      // Generate template ID based on timestamp and a random string for uniqueness
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 8);
      const templateId = `template-${timestamp}-${randomStr}`;
      const filePath = path.join(appDir, `${templateId}.json`);
      
      console.log(`Saving template ${templateData.jobName} to ${filePath}`);
      
      // Write template to file
      fs.writeFileSync(filePath, JSON.stringify(templateData, null, 2), 'utf8');
      
      // Verify the file was created
      if (!fs.existsSync(filePath)) {
        throw new Error(`Template file was not created at ${filePath}`);
      }
      
      // Create and return a new node for the template
      return new PfdaAppNode(
        templateId,
        templateData.jobName || 'Unnamed Template',
        parentNode.dxid,
        parentNode.jsonData,
        PfdaAppNodeType.Template,
        parentNode,
        templateData
      );
    } catch (err) {
      console.error(`Error saving template for app ${parentNode.dxid}:`, err);
      vscode.window.showErrorMessage(`Failed to save template: ${err}`);
      return undefined;
    }
  }
}
