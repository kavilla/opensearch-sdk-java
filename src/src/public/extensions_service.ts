/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Any modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

import { withTimeout } from '@osd/std';
import { PluginName, PluginOpaqueId } from '../../server';
import { CoreService } from '../../types';
import { CoreContext } from '../core_system';
import { ExtensionWrapper } from './extension';
import {
  createExtensionInitializerContext,
  createExtensionSetupContext,
  createExtensionStartContext,
} from './extension_context';
import { InternalCoreSetup, InternalCoreStart } from '../core_system';
import { InjectedPluginMetadata } from '../injected_metadata';

const Sec = 1000;
/** @internal */
export type ExtensionsServiceSetupDeps = InternalCoreSetup;
/** @internal */
export type ExtensionsServiceStartDeps = InternalCoreStart;

/** @internal */
export interface ExtensionsServiceSetup {
  contracts: ReadonlyMap<string, unknown>;
}
/** @internal */
export interface ExtensionsServiceStart {
  contracts: ReadonlyMap<string, unknown>;
}

/**
 * Service responsible for loading extension bundles, initializing extensions, and managing the lifecycle
 * of all extensions.
 *
 * @internal
 */
export class ExtensionsService implements CoreService<ExtensionsServiceSetup, ExtensionsServiceStart> {
  /** Extension wrappers in topological order. */
  private readonly extensions = new Map<PluginName, ExtensionWrapper<unknown, unknown>>();
  private readonly extensionDependencies = new Map<PluginName, PluginName[]>();

  private readonly setupExtensions: PluginName[] = [];

  constructor(private readonly coreContext: CoreContext, extensions: InjectedPluginMetadata[]) {
    // Generate opaque ids
    const opaqueIds = new Map<PluginName, PluginOpaqueId>(extensions.map((p) => [p.id, Symbol(p.id)]));

    // Setup dependency map and extension wrappers
    extensions.forEach(({ id, extension, config = {} }) => {
      // Setup map of dependencies
      this.extensionDependencies.set(id, [
        ...extension.requiredPlugins,
        ...extension.optionalPlugins.filter((optPlugin) => opaqueIds.has(optPlugin)),
      ]);

      // Construct extension wrappers, depending on the topological order set by the server.
      this.extensions.set(
        id,
        new ExtensionWrapper(
          extension,
          opaqueIds.get(id)!,
          createExtensionInitializerContext(this.coreContext, opaqueIds.get(id)!, extension, config)
        )
      );
    });
  }

  public getOpaqueIds(): ReadonlyMap<PluginOpaqueId, PluginOpaqueId[]> {
    // Return dependency map of opaque ids
    return new Map(
      [...this.extensionDependencies].map(([id, deps]) => [
        this.extensions.get(id)!.opaqueId,
        deps.map((depId) => this.extensions.get(depId)!.opaqueId),
      ])
    );
  }

  public async setup(deps: ExtensionsServiceSetupDeps): Promise<ExtensionsServiceSetup> {
    // Setup each extension with required and optional extension contracts
    const contracts = new Map<string, unknown>();
    for (const [pluginName, plugin] of this.extensions.entries()) {
      const pluginDepContracts = [...this.extensionDependencies.get(pluginName)!].reduce(
        (depContracts, dependencyName) => {
          // Only set if present. Could be absent if extension does not have client-side code or is a
          // missing optional plugin.
          if (contracts.has(dependencyName)) {
            depContracts[dependencyName] = contracts.get(dependencyName);
          }

          return depContracts;
        },
        {} as Record<PluginName, unknown>
      );

      const contract = await withTimeout({
        promise: plugin.setup(
          createExtensionSetupContext(this.coreContext, deps, plugin),
          pluginDepContracts
        ),
        timeout: 30 * Sec,
        errorMessage: `Setup lifecycle of "${pluginName}" plugin wasn't completed in 30sec. Consider disabling the plugin and re-start.`,
      });
      contracts.set(pluginName, contract);

      this.setupExtensions.push(pluginName);
    }

    // Expose setup contracts
    return { contracts };
  }

  public async start(deps: ExtensionsServiceStartDeps): Promise<ExtensionsServiceStart> {
    // Setup each extension with required and optional plugin contracts
    const contracts = new Map<string, unknown>();
    for (const [pluginName, plugin] of this.extensions.entries()) {
      const pluginDepContracts = [...this.extensionDependencies.get(pluginName)!].reduce(
        (depContracts, dependencyName) => {
          // Only set if present. Could be absent if extension does not have client-side code or is a
          // missing optional plugin.
          if (contracts.has(dependencyName)) {
            depContracts[dependencyName] = contracts.get(dependencyName);
          }

          return depContracts;
        },
        {} as Record<PluginName, unknown>
      );

      const contract = await withTimeout({
        promise: plugin.start(
          createExtensionStartContext(this.coreContext, deps, plugin),
          pluginDepContracts
        ),
        timeout: 30 * Sec,
        errorMessage: `Start lifecycle of "${pluginName}" extension wasn't completed in 30sec. Consider disabling the extension and re-start.`,
      });
      contracts.set(pluginName, contract);
    }

    // Expose start contracts
    return { contracts };
  }

  public async stop() {
    // Stop plugins in reverse topological order.
    for (const pluginName of this.setupExtensions.reverse()) {
      this.extensions.get(pluginName)!.stop();
    }
  }
}
