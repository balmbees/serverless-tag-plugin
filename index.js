'use strict';

/**
 * This Serverless Plugin add tags for API G/W and Lambda resources
 */

const util = require('util');

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider(this.serverless.service.provider.name);

    const { service } = this.serverless;

    this.data = {
      serviceName: service.service, // "service" is looks like serverless.yml, so "service.service" means "service name"
      region: this.options.region || service.provider.region,
      stage: this.options.stage || service.provider.stage,
    };

    // Check Provideer
    if (service.provider.name === 'aws') {
      this.hooks = {
        'before:package:setupProviderConfiguration': this.beforeSetupProviderConfiguration.bind(this),
        'after:deploy:deploy': this.afterDeploy.bind(this)
      };
    } else {
      this.log('Detected non-aws envirionment. skipping...');
    }
  }

  async getApiId(stage) {
    const [ stack ] = (await this.provider.request('CloudFormation', 'describeStacks', {
      StackName: this.provider.naming.getStackName(stage),
    })).Stacks;

    const stackOutputs = stack.Outputs;

    const apiEndpointUrls = stackOutputs
      .filter((output) => output.OutputKey.includes('ServiceEndpoint'))
      .map((output) => output.OutputValue);

    const apiIds = apiEndpointUrls.map((endpointUrl) => {
      const [ , apiId ] = endpointUrl.match('https:\/\/(.*)\\.execute-api');

      return apiId;
    });

    return apiIds[0];
  }

  beforeSetupProviderConfiguration() {
    this.log('Injecting service-level function tags...');

    const { service } = this.serverless;

    Object.keys(service.functions).forEach((functionName) => {
      const functionDef = service.functions[functionName];

      if (!functionDef.tags) {
        this.log('Detected tags definition on "%s" function is missing. injecting empty object...', functionName);
        functionDef.tags = {};
      }

      ['Name', 'SERVICE_NAME', 'STAGE'].forEach((tagName) => {
        if (functionDef.tags[tagName]) {
          this.log('CAUTION! Function "%s" already have %s tag. It will be overwritten!', functionName, tagName);
        }
      });

      Object.assign(functionDef.tags, {
        Name: `${this.data.serviceName}-${functionName}:${this.data.stage}:${this.data.region}`,
        SERVICE_NAME: this.data.serviceName,
        STAGE: this.data.stage,
      });

      this.log('Injected function tags: ', functionDef.tags);
    });
  }

  async afterDeploy() {
    this.log('Getting deployed apiId');
    const apiId = await this.getApiId(this.data.stage);

    this.log('Tagging API Gateway resource... (apiId: %s)', apiId);

    await this.provider.request('APIGateway', 'tagResource', {
      resourceArn: `arn:aws:apigateway:${this.data.region}::/restapis/${apiId}/stages/${this.data.stage}`,
      tags: {
        Name: `${this.data.serviceName}:${this.data.stage}:${this.data.region}`,
        SERVICE_NAME: this.data.serviceName,
        STAGE: this.data.stage,
      },
    });

    this.log('Done');
  }

  log(...args) {
    if (typeof args[0] === 'string') {
      args[0] = `@vingle/serverless-tag-plugin ${args[0]}`;
    } else {
      args.unshift(`@vingle/serverless-tag-plugin`);
    }

    this.serverless.cli.log(util.format(...args));
  }
}

module.exports = ServerlessPlugin;
