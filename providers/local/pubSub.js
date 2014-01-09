var async = require('async')
  , log = require('../../log')
  , sift = require('sift');

function MemoryPubSubProvider() {
    this.subscriptions = {};
}

MemoryPubSubProvider.prototype.createSubscription = function(subscription, callback) {
    this.subscriptions[subscription.clientId] = subscription;

    return callback();
};

MemoryPubSubProvider.prototype.publish = function(type, item, callback) {
    log.info("MemoryPubSubProvider: publishing " + type + ": " + item.id + ": " + JSON.stringify(item));
    var self = this;

    async.each(Object.keys(this.subscriptions), function(subscriptionId, subscriptionCallback) {
        
        var subscription = self.subscriptions[subscriptionId];

        if (subscription.type === type && subscription.callback) {
            sift(subscription.filter, [item]).forEach(function(unfiltered) {
                subscription.callback(null, item);
            });
        }

        subscriptionCallback();

    }, callback);
};

MemoryPubSubProvider.prototype.receive = function(subscription, callback) {
    subscription.callback = callback;
};

MemoryPubSubProvider.prototype.removeSubscription = function(subscription, callback) {
    delete this.subscriptions[subscription.clientId];

    callback();
};

// TEST ONLY FUNCTIONS

MemoryPubSubProvider.prototype.resetForTest = function(callback) {
    this.subscriptions = {}

    return callback();
};

MemoryPubSubProvider.prototype.subscriptionsForServer = function(serverId, callback) {
    var self = this;
    var subscriptions = Object.keys(this.subscriptions).map(function(key) {
        return self.subscriptions[key];
    });

    return callback(null, subscriptions);
};

module.exports = MemoryPubSubProvider;