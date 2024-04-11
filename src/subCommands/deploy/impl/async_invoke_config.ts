import _ from 'lodash';
import inquirer from 'inquirer';
import { diffConvertYaml } from '@serverless-devs/diff';

import { IInputs, IAsyncInvokeConfig } from '../../../interface';
import logger from '../../../logger';
import Base from './base';
import { GetApiType } from '../../../resources/fc';

interface IOpts {
  yes: boolean | undefined;
}

export default class AsyncInvokeConfig extends Base {
  local: IAsyncInvokeConfig;
  remote: any;
  readonly functionName: string;

  constructor(inputs: IInputs, opts: IOpts) {
    super(inputs, opts.yes);
    this.functionName = inputs.props?.functionName;

    const asyncInvokeConfig = _.get(inputs, 'props.asyncInvokeConfig', {});
    this.local = _.cloneDeep(asyncInvokeConfig) as IAsyncInvokeConfig;
    logger.debug(`need deploy asyncInvokeConfig: ${JSON.stringify(asyncInvokeConfig)}`);
  }

  async before() {
    await this.getRemote();

    await this.plan();
  }

  async run() {
    const remoteConfig = this.remote || {};
    const localConfig = this.local;

    const id = `${this.functionName}/asyncInvokeConfig`;
    const asyncInvokeConfig = _.get(this.inputs, 'props.asyncInvokeConfig', {});
    const qualifier = _.get(asyncInvokeConfig, 'qualifier', 'LATEST');
    if (!_.isEmpty(localConfig)) {
      localConfig.destinationConfig = localConfig.destinationConfig || {};
      if (this.needDeploy) {
        await this.fcSdk.putAsyncInvokeConfig(this.functionName, qualifier, localConfig);
      } else if (_.isEmpty(remoteConfig)) {
        // 如果不需要部署，但是远端资源不存在，则尝试创建一下
        logger.debug(
          `Online asyncInvokeConfig does not exist, specified not to deploy, attempting to create ${id}`,
        );
        await this.fcSdk.putAsyncInvokeConfig(this.functionName, qualifier, localConfig);
      } else {
        logger.debug(
          `Online asyncInvokeConfig exists, specified not to deploy, skipping deployment ${id}`,
        );
      }
    }
    return this.needDeploy;
  }

  private async getRemote() {
    const asyncInvokeConfig = _.get(this.inputs, 'props.asyncInvokeConfig', {});
    const qualifier = _.get(asyncInvokeConfig, 'qualifier', 'LATEST');
    try {
      const result = await this.fcSdk.getAsyncInvokeConfig(
        this.functionName,
        qualifier,
        GetApiType.simpleUnsupported,
      );
      if (result) {
        result.qualifier = qualifier;
      }
      this.remote = result;
    } catch (ex) {
      logger.debug(`Get remote asyncInvokeConfig of  ${this.functionName} error: ${ex.message}`);
      this.remote = {};
    }
  }

  private async plan() {
    if (_.isEmpty(this.remote)) {
      this.needDeploy = true;
      return;
    }
    const { diffResult, show } = diffConvertYaml(this.remote, this.local);
    logger.debug(`diff result: ${JSON.stringify(diffResult)}`);
    logger.debug(`diff show:\n${show}`);

    // 没有差异，直接部署
    if (_.isEmpty(diffResult)) {
      this.needDeploy = true;
      return;
    }
    logger.write(`asyncInvokeConfig was changed, please confirm before deployment:\n`);
    logger.write(show);

    // 用户指定了 --assume-yes，不再交互
    if (_.isBoolean(this.needDeploy)) {
      return;
    }
    logger.write(
      `\n* You can also specify to use local configuration through --assume-yes/-y during deployment`,
    );
    const message = `Deploy it with local config?`;
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'ok',
        message,
      },
    ]);
    this.needDeploy = answers.ok;
  }
}
