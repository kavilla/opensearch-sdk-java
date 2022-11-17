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

/** This module is intended for consumption by public to avoid import issues with server-side code */
export { ExtensionOpaqueId } from '../types';
export * from './saved_objects/types';
export * from './ui_settings/types';
export * from './legacy/types';
export type { EnvironmentMode, PackageInfo } from '@osd/config';
export { Branding } from '../../core/types';
