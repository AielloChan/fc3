import { BaseLocalInvoke } from './baseLocalInvoke';
import _ from 'lodash';
import logger from '../../../../logger';
import * as portFinder from 'portfinder';
import { v4 as uuidV4 } from 'uuid';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { runCommand } from '../../../../utils';

const httpx = require('httpx');
// import axios from 'axios'

export class CustomContainerLocalInvoke extends BaseLocalInvoke {
  private _port: Number;
  private _requestID: string;
  private _dockerName: string;
  getDebugArgs(): string {
    if (_.isFinite(this.getDebugPort())) {
      // TODO 参数支持自定义调试参数实现断点调试
      // 比如调试的是 node 编写的 custom runtime 函数， DebugArgs 可以和 nodejs runtime 的看齐
    }
    return '';
  }

  async getEnvString(): Promise<string> {
    let envStr = await super.getEnvString();
    if (!_.isEmpty(this.getBootStrap())) {
      envStr += ` -e "AGENT_SCRIPT=${this.getBootStrap()}"`;
    }
    return envStr;
  }

  getBootStrap(): string {
    if (!this.isCustomContainerRuntime()) {
      throw new Error('only custom container get command and args');
    }
    let bootStrap = '';
    const { customContainerConfig } = this.inputs.props;
    if (_.has(customContainerConfig, 'entrypoint')) {
      bootStrap += customContainerConfig.entrypoint.join(' ');
    }
    if (_.has(customContainerConfig, 'command')) {
      bootStrap += ` ${customContainerConfig.command.join(' ')}`;
    }
    return bootStrap;
  }

  async getLocalInvokeCmdStr(): Promise<string> {
    const port = await portFinder.getPortPromise({ port: this.getCaPort() });
    // const msg = `You can use curl or Postman to make an HTTP request to 127.0.0.1:${port} to test the function.for example:`;
    // console.log('\x1b[33m%s\x1b[0m', msg);
    this._port = port;
    this._requestID = uuidV4();
    this._dockerName = `fc-docker-${this._requestID}`;

    const image = await this.getRuntimeRunImage();
    // const envStr = await this.getEnvString();
    let dockerCmdStr = `docker run --name ${this._dockerName} -d --platform linux/amd64 --rm -p ${port}:${this.getCaPort()} --memory=${this.getMemorySize()}m ${image}`;
    if (!_.isEmpty(this.getBootStrap())) {
      dockerCmdStr += ` ${this.getBootStrap()}`;
    }
    if (!_.isEmpty(this.getDebugArgs())) {
      if (this.debugIDEIsVsCode()) {
        await this.writeVscodeDebugConfig();
      }
    }
    logger.debug(`You can start the container using the following command: `);
    logger.debug(`${chalk.blue(dockerCmdStr)}\n`);
    return dockerCmdStr;
  }

  async runInvoke() {
    // const image = await this.getRuntimeRunImage();
    // process.on('DEVS:SIGINT', () => {
    //   console.log('\nDEVS:SIGINT, stop container');
    //   const out = execSync(`docker ps -a | grep ${image} | awk '{print $1}' | xargs docker kill`);
    //   logger.debug(`stdout: ${out}`);
    //   process.exit();
    // });
    await super.runInvoke();
    await this.checkServerReady(1000, 20);

    const startTimeStamp = new Date().getTime();
    const credentials = await this.getCredentials();
    const requestId = uuidV4();
    const headers = {
      'Content-Type': 'application/octet-stream',
      'x-fc-request-id': requestId,
      'x-fc-function-name': this.getFunctionName(),
      'x-fc-function-memory': this.getMemorySize(),
      'x-fc-function-timeout': this.getTimeout(),
      'x-fc-function-handler': this.getHandler(),
      'x-fc-region': this.getRegion(),
      'x-fc-account-id': credentials.AccountID,
      'x-fc-access-key-id': credentials.AccessKeyID,
      'x-fc-access-key-secret': credentials.AccessKeySecret,
      'x-fc-security-token': credentials.SecurityToken || '',
      'x-fc-initialization-timeout': this.getInitializerTimeout()
        ? this.getInitializerTimeout()
        : '',
      'x-fc-function-initializer': this.getInitializer() ? this.getInitializer() : '',
    };
    const postData = Buffer.from(this.getEventString(), 'binary');
    const timeout = (this.getTimeout() + 3) * 1000;
    const result = await this.request(
      `http://127.0.0.1:${this._port}/invoke`,
      'POST',
      headers,
      postData,
      timeout,
    );
    const endTimeStamp = new Date().getTime();
    const billedDuration = endTimeStamp - startTimeStamp;
    
    await runCommand(`docker logs ${this._dockerName}`, runCommand.showStdout.append);
    console.log(result.toString());

    let maxMemoryUsed = this.getMemorySize();
    try{
      await runCommand(`docker exec ${this._dockerName} cat /sys/fs/cgroup/cgroup.controllers`, runCommand.showStdout.return);
      maxMemoryUsed = Number(await runCommand(`docker exec ${this._dockerName} cat /sys/fs/cgroup/memory.current`, runCommand.showStdout.return))/1024/1024;
    }catch(e){
      maxMemoryUsed = Number(await runCommand(`docker exec ${this._dockerName} cat /sys/fs/cgroup/memory/memory.usage_in_bytes`, runCommand.showStdout.return))/1024/1024;
    }
    maxMemoryUsed = Math.ceil(maxMemoryUsed);

    // todo 目前无法获取到max memory used信息，暂不打印，以后可以补上
    const abstract = `RequestId: ${requestId}   Billed Duration: ${billedDuration} ms    Memory Size: ${this.getMemorySize()} MB    Max Memory Used: ${maxMemoryUsed} MB`;
    console.log(`${chalk.green(abstract)}\n`);
    // kill container
    const out = execSync(`docker kill ${this._dockerName}`);
    logger.debug(`stdout: ${out}`);
    process.exit();
  }

  async request(url: string, method: any, headers: any, writeData: any, timeout: number) {
    const response = await httpx.request(url, {
      timeout,
      method,
      headers,
      data: writeData,
    });
    const responseBody = await httpx.read(response);
    return responseBody;
  }

  async checkServerReady(delay: number, maxRetries: number) {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await httpx.request(`http://127.0.0.1:${this._port}`, { timeout: 5000 });
        logger.log(`Server running on port ${this._port} is ready!`);
        return;
      } catch (error) {
        retries++;
        logger.log(
          `Server running on port ${this._port} is not yet ready. Retrying in ${delay}ms (${retries}/${maxRetries})`,
        );
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    logger.error(
      `Server running on port ${this._port} is not ready after ${maxRetries} retries. Exiting...`,
    );
  }
}
