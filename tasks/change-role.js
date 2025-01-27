const Promise = require('bluebird');
const GhostAdminAPI = require('@tryghost/admin-api');
const makeTaskRunner = require('../lib/task-runner');
const _ = require('lodash');
const {discover} = require('../lib/batch-ghost-discover');

module.exports.initialise = (options) => {
    return {
        title: 'Initialising API connection',
        task: (ctx, task) => {
            let defaults = {
                verbose: false,
                tag: false,
                author: false,
                delayBetweenCalls: 50
            };

            const url = options.apiURL;
            const key = options.adminAPIKey;
            const api = new GhostAdminAPI({
                url,
                key,
                version: 'v5.0'
            });

            ctx.args = _.mergeWith(defaults, options);
            ctx.api = api;
            ctx.users = [];
            ctx.updated = [];

            task.output = `Initialised API connection for ${options.apiURL}`;
        }
    };
};

module.exports.getFullTaskList = (options) => {
    return [
        this.initialise(options),
        {
            title: 'Fetch Content from Ghost API',
            task: async (ctx, task) => {
                let discoveryOptions = {
                    api: ctx.api,
                    type: 'users',
                    limit: 50
                };

                try {
                    ctx.users = await discover(discoveryOptions);
                    task.output = `Found ${ctx.users.length} users`;
                } catch (error) {
                    ctx.errors.push(error);
                    throw error;
                }

                // Filter out the owner role, as this cannot be changed
                ctx.users = _.filter(ctx.users, (user) => {
                    const isOwner = _.find(user.roles, {name: 'Owner'});

                    if (!isOwner) {
                        return user;
                    }
                });
            }
        },
        {
            title: 'Filter staff roles',
            skip: () => !options.filterRole.length,
            task: (ctx, task) => {
                ctx.users = ctx.users.filter((user) => {
                    if (options.filterRole.includes(user.roles[0].name)) {
                        return true;
                    } else {
                        return false;
                    }
                });
                task.output = `Found ${ctx.users.length} users with specific roles`;
            }
        },
        {
            title: 'Updating users from Ghost',
            task: async (ctx) => {
                let tasks = [];

                await Promise.mapSeries(ctx.users, async (user) => {
                    tasks.push({
                        title: `Updating ${user.slug}`,
                        task: async () => {
                            try {
                                let result = await ctx.api.users.edit({
                                    id: user.id,
                                    roles: [ctx.args.newRole]
                                });
                                ctx.updated.push(result);
                                return Promise.delay(options.delayBetweenCalls).return(result);
                            } catch (error) {
                                ctx.errors.push(error);
                                throw error;
                            }
                        }
                    });
                });

                let taskOptions = options;
                taskOptions.concurrent = 1;
                return makeTaskRunner(tasks, taskOptions);
            }
        }
    ];
};

module.exports.getTaskRunner = (options) => {
    let tasks = [];

    tasks = this.getFullTaskList(options);

    return makeTaskRunner(tasks, Object.assign({topLevel: true}, options));
};
