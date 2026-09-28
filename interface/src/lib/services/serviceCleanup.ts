/**
 * Service Cleanup Module
 * Provides unified cleanup for all singleton services to prevent memory leaks
 * Part of Phase 2 WebSocket consolidation and cleanup
 *
 * Note: parameterOSCService removed - now integrated into selectedTrackStore
 */

import { instrumentDisplayCoordinator } from './instrumentDisplayCoordinator.svelte';
import { clipDisplayCoordinator } from './clipDisplayCoordinator.svelte';
import { logger } from '$lib/utils/logger';

/**
 * Destroy all singleton services
 * Should be called on app unmount or when cleaning up
 */
export function destroyAllServices() {
  logger.debug('Destroying all services...', { component: 'serviceCleanup' });

  // Destroy instrument display coordinator
  try {
    instrumentDisplayCoordinator.destroy();
    logger.debug('✓ Instrument display coordinator destroyed', { component: 'serviceCleanup' });
  } catch (error) {
    logger.error('Failed to destroy instrument display coordinator:', { component: 'serviceCleanup', error });
  }

  // Destroy clip display coordinator
  try {
    clipDisplayCoordinator.destroy();
    logger.debug('✓ Clip display coordinator destroyed', { component: 'serviceCleanup' });
  } catch (error) {
    logger.error('Failed to destroy clip display coordinator:', { component: 'serviceCleanup', error });
  }
}

/**
 * Initialize all services
 * Should be called on app mount
 */
export function initializeAllServices() {
  logger.debug('Initializing all services...', { component: 'serviceCleanup' });

  // Initialize instrument display coordinator
  try {
    instrumentDisplayCoordinator.initialize();
    logger.debug('✓ Instrument display coordinator initialized', { component: 'serviceCleanup' });
  } catch (error) {
    logger.error('Failed to initialize instrument display coordinator:', { component: 'serviceCleanup', error });
  }

  // Initialize clip display coordinator
  try {
    clipDisplayCoordinator.initialize();
    logger.debug('✓ Clip display coordinator initialized', { component: 'serviceCleanup' });
  } catch (error) {
    logger.error('Failed to initialize clip display coordinator:', { component: 'serviceCleanup', error });
  }
}

/**
 * Individual service destroy functions
 * Can be used for selective cleanup
 */
export function destroyInstrumentCoordinator() {
  instrumentDisplayCoordinator.destroy();
}

export function destroyClipCoordinator() {
  clipDisplayCoordinator.destroy();
}
