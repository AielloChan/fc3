export default {
  help: {
    description: `Synchronize online resources to offline resources.
Example:
  $ s3 sync
  $ s3 sync --target ./test --qualifier testAlias
  $ s3 cli fc3 sync --region cn-hangzhou --function-name test -a default`,
    summary: 'Synchronize online resources to offline resources',
    option: [
      [
        '--region <region>',
        '[C-Required] Specify fc region, you can see all supported regions in https://www.alibabacloud.com/help/zh/fc/product-overview/region-availability',
      ],
      ['--function-name <functionName>', '[C-Required] Specify function name'],
      [
        '--target-dir <target-dir>',
        '[Optional] [Optional] Specify storage directory, default is current directory',
      ],
      ['--qualifier <qualifier>', '[Optional] Specify version or alias, default is LATEST'],
    ],
  },
};
