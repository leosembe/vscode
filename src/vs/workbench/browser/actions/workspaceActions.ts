/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { Action } from 'vs/base/common/actions';
import nls = require('vs/nls');
import { distinct } from 'vs/base/common/arrays';
import { IWindowService, IWindowsService } from 'vs/platform/windows/common/windows';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspace/common/workspaceEditing';
import URI from 'vs/base/common/uri';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IInstantiationService } from "vs/platform/instantiation/common/instantiation";
import { IWorkspacesService, WORKSPACE_FILTER } from "vs/platform/workspaces/common/workspaces";
import { IEnvironmentService } from "vs/platform/environment/common/environment";
import { isWindows, isLinux } from "vs/base/common/platform";
import { dirname } from "vs/base/common/paths";

export class OpenFolderAction extends Action {

	static ID = 'workbench.action.files.openFolder';
	static LABEL = nls.localize('openFolder', "Open Folder...");

	constructor(
		id: string,
		label: string,
		@IWindowService private windowService: IWindowService
	) {
		super(id, label);
	}

	run(event?: any, data?: ITelemetryData): TPromise<any> {
		return this.windowService.pickFolderAndOpen(undefined, data);
	}
}

export class OpenFileFolderAction extends Action {

	static ID = 'workbench.action.files.openFileFolder';
	static LABEL = nls.localize('openFileFolder', "Open...");

	constructor(
		id: string,
		label: string,
		@IWindowService private windowService: IWindowService
	) {
		super(id, label);
	}

	run(event?: any, data?: ITelemetryData): TPromise<any> {
		return this.windowService.pickFileFolderAndOpen(undefined, data);
	}
}

export abstract class BaseWorkspacesAction extends Action {

	constructor(
		id: string,
		label: string,
		protected windowService: IWindowService,
		protected environmentService: IEnvironmentService,
		protected contextService: IWorkspaceContextService
	) {
		super(id, label);
	}

	protected handleNotInMultiFolderWorkspaceCase(message: string, actionLabel: string): boolean {
		const newWorkspace = { label: this.mnemonicLabel(actionLabel), canceled: false };
		const cancel = { label: nls.localize('cancel', "Cancel"), canceled: true };

		const buttons: { label: string; canceled: boolean; }[] = [];
		if (isLinux) {
			buttons.push(cancel, newWorkspace);
		} else {
			buttons.push(newWorkspace, cancel);
		}

		const opts: Electron.ShowMessageBoxOptions = {
			title: this.environmentService.appNameLong,
			message,
			noLink: true,
			type: 'info',
			buttons: buttons.map(button => button.label),
			cancelId: buttons.indexOf(cancel)
		};

		if (isLinux) {
			opts.defaultId = 1;
		}

		const res = this.windowService.showMessageBox(opts);
		return !buttons[res].canceled;
	}

	private mnemonicLabel(label: string): string {
		if (!isWindows) {
			return label.replace(/\(&&\w\)|&&/g, ''); // no mnemonic support on mac/linux
		}

		return label.replace(/&&/g, '&');
	}

	protected pickFolders(button: string, title: string): string[] {
		return this.windowService.showOpenDialog({
			buttonLabel: nls.localize('add', "Add"),
			title: nls.localize('addFolderToWorkspaceTitle', "Add Folder to Workspace"),
			properties: ['multiSelections', 'openDirectory', 'createDirectory'],
			defaultPath: this.contextService.hasWorkspace() ? dirname(this.contextService.getWorkspace().roots[0].fsPath) : void 0 // pick the parent of the first root by default
		});
	}

}

export class NewWorkspaceAction extends BaseWorkspacesAction {

	static ID = 'workbench.action.newWorkspace';
	static LABEL = nls.localize('newWorkspace', "New Workspace...");

	constructor(
		id: string,
		label: string,
		@IWindowService windowService: IWindowService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IWorkspacesService protected workspacesService: IWorkspacesService,
		@IWindowsService protected windowsService: IWindowsService,
	) {
		super(id, label, windowService, environmentService, contextService);
	}

	public run(): TPromise<any> {
		let folders = this.pickFolders(nls.localize('select', "Select"), nls.localize('selectWorkspace', "Select Folders for Workspace"));
		if (folders && folders.length) {
			return this.createWorkspace(folders.map(folder => URI.file(folder)));
		}

		return TPromise.as(null);
	}

	protected createWorkspace(folders: URI[]): TPromise<void> {
		return this.workspacesService.createWorkspace(distinct(folders.map(folder => folder.toString(true /* encoding */))))
			.then(({ configPath }) => this.windowsService.openWindow([configPath]));
	}
}

export class NewWorkspaceFromExistingAction extends NewWorkspaceAction {

	static ID = 'workbench.action.newWorkspaceFromExisting';
	static LABEL = nls.localize('newWorkspaceFormExisting', "New Workspace From Existing...");

	public run(): TPromise<any> {
		let folders = this.pickFolders(nls.localize('select', "Select"), nls.localize('selectWorkspace', "Select Folders for Workspace"));
		if (folders && folders.length) {
			if (this.contextService.hasWorkspace()) {
				return this.createWorkspace([this.contextService.getWorkspace().roots[0], ...folders.map(folder => URI.file(folder))]);
			}
		}

		return TPromise.as(null);
	}
}

export class AddRootFolderAction extends BaseWorkspacesAction {

	static ID = 'workbench.action.addRootFolder';
	static LABEL = nls.localize('addFolderToWorkspace', "Add Folder to Workspace...");

	constructor(
		id: string,
		label: string,
		@IWindowService windowService: IWindowService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IWorkspaceEditingService private workspaceEditingService: IWorkspaceEditingService,
		@IViewletService private viewletService: IViewletService
	) {
		super(id, label, windowService, environmentService, contextService);
	}

	public run(): TPromise<any> {
		if (!this.contextService.hasMultiFolderWorkspace()) {
			if (this.handleNotInMultiFolderWorkspaceCase(nls.localize('addSupported', "Adding a folder to workspace is not supported when VS Code is opened with a folder. Do you want to create a new workspace with the current folder and add?"), nls.localize({ key: 'createAndAdd', comment: ['&& denotes a mnemonic'] }, "&&Create Workspace & Add"))) {
				return this.instantiationService.createInstance(NewWorkspaceFromExistingAction, NewWorkspaceFromExistingAction.ID, NewWorkspaceFromExistingAction.LABEL).run();
			}
			return TPromise.as(null);
		}

		const folders = super.pickFolders(nls.localize('add', "Add"), nls.localize('addFolderToWorkspaceTitle', "Add Folder to Workspace"));
		if (!folders || !folders.length) {
			return TPromise.as(null);
		}

		return this.workspaceEditingService.addRoots(folders.map(folder => URI.file(folder))).then(() => {
			return this.viewletService.openViewlet(this.viewletService.getDefaultViewletId(), true);
		});
	}
}

export class RemoveRootFolderAction extends Action {

	static ID = 'workbench.action.removeRootFolder';
	static LABEL = nls.localize('removeFolderFromWorkspace', "Remove Folder from Workspace");

	constructor(
		private rootUri: URI,
		id: string,
		label: string,
		@IWorkspaceEditingService private workspaceEditingService: IWorkspaceEditingService
	) {
		super(id, label);
	}

	public run(): TPromise<any> {
		return this.workspaceEditingService.removeRoots([this.rootUri]);
	}
}

export class SaveWorkspaceAction extends BaseWorkspacesAction {

	static ID = 'workbench.action.saveWorkspace';
	static LABEL = nls.localize('saveWorkspaceAction', "Save Workspace...");

	constructor(
		id: string,
		label: string,
		@IWindowService windowService: IWindowService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IWorkspacesService protected workspacesService: IWorkspacesService,
		@IWindowsService private windowsService: IWindowsService
	) {
		super(id, label, windowService, environmentService, contextService);
	}

	public run(): TPromise<any> {
		if (this.contextService.hasFolderWorkspace()) {
			return this.saveFolderWorkspace();
		}

		if (this.contextService.hasMultiFolderWorkspace()) {
			this.saveMultiFolderWorkspace();
		}

		return TPromise.as(false);
	}

	private saveFolderWorkspace(): TPromise<void> {
		if (this.handleNotInMultiFolderWorkspaceCase(nls.localize('saveNotSupported', "Saving a workspace is not supported when VS Code is opened with a folder. Do you want to create a new workspace with the existing folder and save?"), nls.localize({ key: 'createAndSave', comment: ['&& denotes a mnemonic'] }, "&&Create Workspace & Save"))) {
			const configPath = this.getNewWorkspaceConfiPath();
			if (configPath) {
				// Create workspace first
				this.workspacesService.createWorkspace(this.contextService.getWorkspace().roots.map(root => root.toString(true /* skip encoding */)))
					.then(workspaceIdentifier => {
						// Save the workspace in new location
						return this.workspacesService.saveWorkspace(workspaceIdentifier, configPath)
							// Open the saved workspace
							.then(({ configPath }) => this.windowsService.openWindow([configPath]));
					});
			}
		}
		return TPromise.as(null);
	}

	private saveMultiFolderWorkspace(): TPromise<void> {
		const target = this.getNewWorkspaceConfiPath();

		if (target) {
			return this.contextService.saveWorkspace(URI.file(target));
		}

		return TPromise.as(null);
	}

	private getNewWorkspaceConfiPath(): string {
		return this.windowService.showSaveDialog({
			buttonLabel: nls.localize('save', "Save"),
			title: nls.localize('saveWorkspace', "Save Workspace"),
			filters: WORKSPACE_FILTER,
			defaultPath: dirname(this.contextService.getWorkspace().roots[0].fsPath) // pick the parent of the first root by default
		});
	}
}

export class OpenWorkspaceAction extends Action {

	static ID = 'workbench.action.openWorkspace';
	static LABEL = nls.localize('openWorkspaceAction', "Open Workspace...");

	constructor(
		id: string,
		label: string,
		@IWindowService private windowService: IWindowService,
		@IWindowsService private windowsService: IWindowsService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService
	) {
		super(id, label);
	}

	public run(): TPromise<any> {
		const files = this.windowService.showOpenDialog({
			buttonLabel: nls.localize('open', "Open"),
			title: nls.localize('openWorkspace', "Open Workspace"),
			filters: WORKSPACE_FILTER,
			properties: ['openFile'],
			defaultPath: this.contextService.hasWorkspace() ? dirname(this.contextService.getWorkspace().roots[0].fsPath) : void 0 // pick the parent of the first root by default
		});

		if (!files || !files.length) {
			return TPromise.as(null);
		}

		return this.windowsService.openWindow([files[0]]);
	}
}