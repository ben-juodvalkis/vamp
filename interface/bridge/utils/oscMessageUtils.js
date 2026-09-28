/**
 * OSC Message Utilities
 *
 * Helper functions for processing and routing OSC messages.
 */

const { logger, LogLevel } = require('./logger');

/**
 * Process an incoming OSC message and prepare it for broadcast
 * @param {Object} oscMessage - Raw OSC message with address and args
 * @param {string} source - Source identifier (e.g., 'pythonSurface', 'loopingRecorder')
 * @param {Object} metrics - Metrics object to update
 * @returns {Object} Client-ready message object
 */
function processIncomingMessage(oscMessage, source, metrics) {
    metrics.totalMessages++;

    // `'output_meter'.includes('meter')` is true, so the second disjunct this
    // used to carry could never decide anything.
    const isMeterMessage = oscMessage.address.includes('meter');

    // Log non-meter messages (meters are too frequent). The level test comes
    // FIRST: the payload walks every arg with `.map()`, and passing it as an
    // argument built it on every non-meter message whatever the log level —
    // which at WARN (the default) is an allocation and a walk per message for
    // a string nothing ever formats.
    if (!isMeterMessage && logger.shouldLog(LogLevel.DEBUG)) {
        logger.debug('Message received', {
            address: oscMessage.address,
            args: oscMessage.args,
            argCount: oscMessage.args?.length,
            argTypes: oscMessage.args?.map(arg => typeof arg),
            source: source
        });
    }

    // Create client message with source metadata
    return {
        address: oscMessage.address,
        args: oscMessage.args,
        timestamp: Date.now(),
        source: source
    };
}

module.exports = {
    processIncomingMessage
};
