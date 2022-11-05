/* eslint-disable @typescript-eslint/ban-types */
// Note: disabling ban-type rule so we don't get an error referencing the class Function

import path from "path";
import type { Loader } from "esbuild";
import fs from "fs-extra";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";

import { State, Runtime, DeferBuilder, FunctionBinding } from "@serverless-stack/core";
import { App } from "./App.js";
import { Stack } from "./Stack.js";
import { Job } from "./Job.js";
import { Secret, Parameter } from "./Config.js";
import { isSSTConstruct, SSTConstruct } from "./Construct.js";
import { Size, toCdkSize } from "./util/size.js";
import { Duration, toCdkDuration } from "./util/duration.js";
import { bindEnvironment, bindPermissions } from "./util/functionBinding.js";
import { Permissions, attachPermissionsToRole } from "./util/permission.js";
import * as functionUrlCors from "./util/functionUrlCors.js";

import url from "url";
import { useDeferredTasks } from "./deferred_task.js";
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const supportedRuntimes = {
  nodejs: lambda.Runtime.NODEJS,
  "nodejs4.3": lambda.Runtime.NODEJS_4_3,
  "nodejs6.10": lambda.Runtime.NODEJS_6_10,
  "nodejs8.10": lambda.Runtime.NODEJS_8_10,
  "nodejs10.x": lambda.Runtime.NODEJS_10_X,
  "nodejs12.x": lambda.Runtime.NODEJS_12_X,
  "nodejs14.x": lambda.Runtime.NODEJS_14_X,
  "nodejs16.x": lambda.Runtime.NODEJS_16_X,
  "python2.7": lambda.Runtime.PYTHON_2_7,
  "python3.6": lambda.Runtime.PYTHON_3_6,
  "python3.7": lambda.Runtime.PYTHON_3_7,
  "python3.8": lambda.Runtime.PYTHON_3_8,
  "python3.9": lambda.Runtime.PYTHON_3_9,
  "dotnetcore1.0": lambda.Runtime.DOTNET_CORE_1,
  "dotnetcore2.0": lambda.Runtime.DOTNET_CORE_2,
  "dotnetcore2.1": lambda.Runtime.DOTNET_CORE_2_1,
  "dotnetcore3.1": lambda.Runtime.DOTNET_CORE_3_1,
  dotnet6: lambda.Runtime.DOTNET_6,
  java8: lambda.Runtime.JAVA_8,
  java11: lambda.Runtime.JAVA_11,
  "go1.x": lambda.Runtime.GO_1_X,
};

export type Runtime = keyof typeof supportedRuntimes;
export type FunctionInlineDefinition = string | Function;
export type FunctionDefinition = string | Function | FunctionProps;
export interface FunctionUrlCorsProps extends functionUrlCors.CorsProps {}

export interface FunctionProps
  extends Omit<
    lambda.FunctionOptions,
    | "functionName"
    | "memorySize"
    | "timeout"
    | "runtime"
    | "tracing"
    | "layers"
    | "architecture"
    | "logRetention"
  > {
  /**
   * The CPU architecture of the lambda function.
   *
   * @default "x86_64"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   architecture: "arm_64",
   * })
   * ```
   */
  architecture?: Lowercase<
    keyof Pick<typeof lambda.Architecture, "ARM_64" | "X86_64">
  >;
  /**
   * By default, the name of the function is auto-generated by AWS. You can configure the name by providing a string.
   *
   * @default Auto-generated function name
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   functionName: "my-function",
   * })
   *```
   */
  functionName?: string | ((props: FunctionNameProps) => string);
  /**
   * Path to the entry point and handler function. Of the format:
   * `/path/to/file.function`.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   * })
   *```
   */
  handler?: string;
  /**
   * Root directory of the project, typically where package.json is located. Set if using a monorepo with multiple subpackages
   *
   * @default Defaults to the same directory as sst.json
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   srcPath: "packages/backend",
   *   handler: "function.handler",
   * })
   *```
   */
  srcPath?: string;
  /**
   * The runtime environment. Only runtimes of the Node.js, Python, Go, and .NET (C# and F#) family are supported.
   *
   * @default "nodejs14.x"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   runtime: "nodejs16.x",
   * })
   *```
   */
  runtime?: Runtime;
  /**
   * The amount of disk storage in MB allocated.
   *
   * @default "512 MB"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   diskSize: "2 GB",
   * })
   *```
   */
  diskSize?: number | Size;
  /**
   * The amount of memory in MB allocated.
   *
   * @default "1 GB"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   memorySize: "2 GB",
   * })
   *```
   */
  memorySize?: number | Size;
  /**
   * The execution timeout in seconds.
   *
   * @default "10 seconds"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   timeout: "30 seconds",
   * })
   *```
   */
  timeout?: number | Duration;
  /**
   * Enable AWS X-Ray Tracing.
   *
   * @default "active"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   tracing: "pass_through",
   * })
   *```
   */
  tracing?: Lowercase<keyof typeof lambda.Tracing>;
  /**
   * Can be used to disable Live Lambda Development when using `sst start`. Useful for things like Custom Resources that need to execute during deployment.
   *
   * @default true
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   enableLiveDev: false
   * })
   *```
   */
  enableLiveDev?: boolean;
  /**
   * Configure environment variables for the function
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   environment: {
   *     TABLE_NAME: table.tableName,
   *   }
   * })
   * ```
   */
  environment?: Record<string, string>;
  /**
   * Configure or disable bundling options
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   bundle: {
   *     copyFiles: [{ from: "src/index.js" }]
   *   }
   * })
   *```
   */
  bundle?: FunctionBundleProp;
  /**
   * Bind resources for the function
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   bind: [STRIPE_KEY, bucket],
   * })
   * ```
   */
  bind?: SSTConstruct[];
  /**
   * Configure environment variables for the function
   *
   * @deprecated The "config" prop is deprecated, and will be removed in SST v2. Pass Parameters and Secrets in through the "bind" prop. Read more about how to upgrade here — https://docs.serverless-stack.com/constructs/function
   * 
   * @example
   * ```js
   * // Change
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   config: [STRIPE_KEY, API_URL]
   * })
   * 
   * // To
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   bind: [STRIPE_KEY, API_URL]
   * })
   * ```
   */
  config?: (Secret | Parameter)[];
  /**
   * Attaches the given list of permissions to the function. Configuring this property is equivalent to calling `attachPermissions()` after the function is created.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   permissions: ["ses"]
   * })
   * ```
   */
  permissions?: Permissions;
  /**
   * Enable function URLs, a dedicated endpoint for your Lambda function.
   * @default Disabled
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: true
   * })
   * ```
   *
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     authorizer: "iam",
   *     cors: {
   *       allowedOrigins: ['https://example.com'],
   *     },
   *   },
   * })
   * ```
   */
  url?: boolean | FunctionUrlProps;
  /**
   * A list of Layers to add to the function's execution environment.
   *
   * Note that, if a Layer is created in a stack (say `stackA`) and is referenced in another stack (say `stackB`), SST automatically creates an SSM parameter in `stackA` with the Layer's ARN. And in `stackB`, SST reads the ARN from the SSM parameter, and then imports the Layer.
   *
   *  This is to get around the limitation that a Lambda Layer ARN cannot be referenced across stacks via a stack export. The Layer ARN contains a version number that is incremented everytime the Layer is modified. When you refer to a Layer's ARN across stacks, a CloudFormation export is created. However, CloudFormation does not allow an exported value to be updated. Once exported, if you try to deploy the updated layer, the CloudFormation update will fail. You can read more about this issue here - https://github.com/serverless-stack/sst/issues/549.
   *
   * @default no layers
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   layers: ["arn:aws:lambda:us-east-1:764866452798:layer:chrome-aws-lambda:22", myLayer]
   * })
   * ```
   */
  layers?: (string | lambda.ILayerVersion)[];
  /**
   * The duration function logs are kept in CloudWatch Logs.
   *
   * When updating this property, unsetting it doesn't retain the logs indefinitely. Explicitly set the value to "infinite".
   * @default Logs retained indefinitely
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   logRetention: "one_week"
   * })
   * ```
   */
  logRetention?: Lowercase<keyof typeof logs.RetentionDays>;
}

export interface FunctionNameProps {
  /**
   * The stack the function is being created in
   */
  stack: Stack;
  /**
   * The function properties
   */
  functionProps: FunctionProps;
}

export interface FunctionHandlerProps {
  srcPath: string;
  handler: string;
  bundle: FunctionBundleProp;
  runtime: string;
}

export interface FunctionUrlProps {
  /**
   * The authorizer for the function URL
   * @default "none"
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     authorizer: "iam",
   *   },
   * })
   * ```
   */
  authorizer?: "none" | "iam";
  /**
   * CORS support for the function URL
   * @default true
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     cors: true,
   *   },
   * })
   * ```
   *
   * ```js
   * new Function(stack, "Function", {
   *   handler: "src/function.handler",
   *   url: {
   *     cors: {
   *       allowedMethods: ["GET", "POST"]
   *       allowedOrigins: ['https://example.com'],
   *     },
   *   },
   * })
   * ```
   */
  cors?: boolean | FunctionUrlCorsProps;
}

export type FunctionBundleProp =
  | FunctionBundleNodejsProps
  | FunctionBundlePythonProps
  | FunctionBundleJavaProps
  | boolean;

interface FunctionBundleBase {
  /**
   * Used to configure additional files to copy into the function bundle
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     copyFiles: [{ from: "src/index.js" }]
   *   }
   * })
   *```
   */
  copyFiles?: FunctionBundleCopyFilesProps[];
}

/**
 * Used to configure NodeJS bundling options
 *
 * @example
 * ```js
 * new Function(stack, "Function", {
 *   bundle: {
 *    format: "esm",
 *    minify: false
 *   }
 * })
 * ```
 */
export interface FunctionBundleNodejsProps extends FunctionBundleBase {
  /**
   * Configure additional esbuild loaders for other file extensions
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     loader: {
   *      ".png": "file"
   *     }
   *   }
   * })
   * ```
   */
  loader?: Record<string, Loader>;
  /**
   * Packages that will not be included in the bundle. Usually used to exclude dependencies that are provided in layers
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     externalModules: ["prisma"]
   *   }
   * })
   * ```
   */
  externalModules?: string[];

  /**
   * Packages that will be excluded from the bundle and installed into node_modules instead. Useful for dependencies that cannot be bundled, like those with binary dependencies.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     nodeModules: ["pg"]
   *   }
   * })
   * ```
   */
  nodeModules?: string[];

  /**
   * Use this to insert an arbitrary string at the beginning of generated JavaScript and CSS files.
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     banner: "console.log('Function starting')"
   *   }
   * })
   * ```
   */
  banner?: string;

  /**
   * Hooks to run at various stages of bundling
   */
  commandHooks?: lambdaNode.ICommandHooks;
  /**
   * This allows you to customize esbuild config.
   */
  esbuildConfig?: {
    /**
     * Replace global identifiers with constant expressions.
     *
     * @example
     * ```js
     * new Function(stack, "Function", {
     *   bundle: {
     *     esbuildConfig: {
     *       define: {
     *         str: "text"
     *       }
     *     }
     *   }
     * })
     * ```
     */
    define?: Record<string, string>;
    /**
     * When minifying preserve names of functions and variables
     *
     * @example
     * ```js
     * new Function(stack, "Function", {
     *   bundle: {
     *     esbuildConfig: {
     *       keepNames: true
     *     }
     *   }
     * })
     * ```
     */
    keepNames?: boolean;
    /**
     * Path to a file that returns an array of esbuild plugins
     *
     * @example
     * ```js
     * new Function(stack, "Function", {
     *   bundle: {
     *     esbuildConfig: {
     *       plugins: "path/to/plugins.js"
     *     }
     *   }
     * })
     * ```
     *
     * Where `path/to/plugins.js` looks something like this:
     *
     * ```js
     * const { esbuildDecorators } = require("@anatine/esbuild-decorators");
     *
     * module.exports = [
     *   esbuildDecorators(),
     * ];
     * ```
     */
    plugins?: string;
  };
  /**
   * Enable or disable minification
   *
   * @default true
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     minify: false
   *   }
   * })
   * ```
   */
  minify?: boolean;
  /**
   * Configure bundle format
   *
   * @default "cjs"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     format: "esm"
   *   }
   * })
   * ```
   */
  format?: "cjs" | "esm";
  /**
   * Configure if sourcemaps are generated when the function is bundled for production. Since they increase payload size and potentially cold starts they are not generated by default. They are always generated during local development mode.
   *
   * @default false
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *   sourcemap: true
   *   }
   * })
   * ```
   */
  sourcemap?: boolean;
}

/**
 * Used to configure Python bundling options
 */
export interface FunctionBundlePythonProps extends FunctionBundleBase {
  /**
   * A list of commands to override the [default installing behavior](Function#bundle) for Python dependencies.
   *
   * Each string in the array is a command that'll be run. For example:
   *
   * @default "[]"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     installCommands: [
   *       'export VARNAME="my value"',
   *       'pip install --index-url https://domain.com/pypi/myprivatemodule/simple/ --extra-index-url https://pypi.org/simple -r requirements.txt .',
   *     ]
   *   }
   * })
   * ```
   */
  installCommands?: string[];
}

/**
 * Used to configure Java package build options
 */
export interface FunctionBundleJavaProps extends FunctionBundleBase {
  /**
   * Gradle build command to generate the bundled .zip file.
   *
   * @default "build"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     buildTask: "bundle"
   *   }
   * })
   * ```
   */
  buildTask?: string;
  /**
   * The output folder that the bundled .zip file will be created within.
   *
   * @default "distributions"
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     buildOutputDir: "output"
   *   }
   * })
   * ```
   */
  buildOutputDir?: string;
  /**
   * Use custom Amazon Linux runtime instead of Java runtime.
   *
   * @default Not using provided runtime
   *
   * @example
   * ```js
   * new Function(stack, "Function", {
   *   bundle: {
   *     experimentalUseProvidedRuntime: "provided.al2"
   *   }
   * })
   * ```
   */
  experimentalUseProvidedRuntime?: "provided" | "provided.al2";
}

/**
 * Used to configure additional files to copy into the function bundle
 *
 * @example
 * ```js
 * new Function(stack, "Function", {
 *   bundle: {
 *     copyFiles: [{ from: "src/index.js" }]
 *   }
 * })
 *```
 */

export interface FunctionBundleCopyFilesProps {
  /**
   * Source path relative to sst.json
   */
  from: string;
  /**
   * Destination path relative to function root in bundle
   */
  to?: string;
}

/**
 * The `Function` construct is a higher level CDK construct that makes it easy to create a Lambda Function with support for Live Lambda Development.
 *
 * @example
 *
 * ```js
 * import { Function } from "@serverless-stack/resources";
 *
 * new Function(stack, "MySnsLambda", {
 *   handler: "src/sns/index.main",
 * });
 * ```
 */
export class Function extends lambda.Function implements SSTConstruct {
  public readonly id: string;
  public readonly _isLiveDevEnabled: boolean;
  /** @internal */
  public _disableBind?: boolean;
  private readonly localId: string;
  private functionUrl?: lambda.FunctionUrl;
  private props: FunctionProps;

  constructor(scope: Construct, id: string, props: FunctionProps) {
    const app = scope.node.root as App;
    const stack = Stack.of(scope) as Stack;

    // Merge with app defaultFunctionProps
    // note: reverse order so later prop override earlier ones
    stack.defaultFunctionProps
      .slice()
      .reverse()
      .forEach((per) => {
        props = Function.mergeProps(per, props);
      });

    // Set defaults
    const functionName =
      props.functionName &&
      (typeof props.functionName === "string"
        ? props.functionName
        : props.functionName({ stack, functionProps: props }));
    const handler = props.handler;
    const timeout = Function.normalizeTimeout(props.timeout);
    const srcPath = Function.normalizeSrcPath(props.srcPath || ".");
    const runtime = Function.normalizeRuntime(props.runtime);
    const architecture = (() => {
      if (props.architecture === "arm_64") return lambda.Architecture.ARM_64;
      if (props.architecture === "x86_64") return lambda.Architecture.X86_64;
      return undefined;
    })();
    const memorySize = Function.normalizeMemorySize(props.memorySize);
    const diskSize = Function.normalizeDiskSize(props.diskSize);
    const tracing =
      lambda.Tracing[
        (props.tracing || "active").toUpperCase() as keyof typeof lambda.Tracing
      ];
    const logRetention =
      props.logRetention &&
      logs.RetentionDays[
        props.logRetention.toUpperCase() as keyof typeof logs.RetentionDays
      ];
    let bundle = props.bundle;
    const isLiveDevEnabled = props.enableLiveDev === false ? false : true;

    // Validate handler
    if (!handler) {
      throw new Error(`No handler defined for the "${id}" Lambda function`);
    }

    // Validate input
    const isNodeRuntime = runtime.startsWith("nodejs");
    const isPythonRuntime = runtime.startsWith("python");
    const isJavaRuntime = runtime.startsWith("java");
    if (isNodeRuntime) {
      bundle = bundle === undefined ? true : props.bundle;
      if (!bundle && srcPath === ".") {
        throw new Error(
          `Bundle cannot be disabled for the "${id}" function since the "srcPath" is set to the project root. Read more here — https://github.com/serverless-stack/sst/issues/78`
        );
      }
    } else if (isPythonRuntime) {
      bundle = bundle === undefined ? {} : props.bundle;
      if (srcPath === ".") {
        throw new Error(
          `Cannot set the "srcPath" to the project root for the "${id}" function.`
        );
      }
    }

    const localId = path.posix
      .join(scope.node.path, id)
      .replace(/\$/g, "-")
      .replace(/\//g, "-")
      .replace(/\./g, "-");

    // Handle local development (ie. sst start)
    // - set runtime to nodejs12.x for non-Node runtimes (b/c the stub is in Node)
    // - set retry to 0. When the debugger is disconnected, the Cron construct
    //   will still try to periodically invoke the Lambda, and the requests would
    //   fail and retry. So when launching `sst start`, a couple of retry requests
    //   from recent failed request will be received. And this behavior is confusing.
    if (isLiveDevEnabled && app.mode === "start") {
      // If debugIncreaseTimeout is enabled:
      //   set timeout to 900s. This will give people more time to debug the function
      //   without timing out the request. Note API Gateway requests have a maximum
      //   timeout of 29s. In this case, the API will timeout, but the Lambda function
      //   will continue to run.
      let debugOverrideProps;
      if (app.debugIncreaseTimeout) {
        debugOverrideProps = {
          timeout: cdk.Duration.seconds(900),
        };
      }

      super(scope, id, {
        ...props,
        architecture,
        code: lambda.Code.fromAsset(
          path.resolve(__dirname, "../dist/support/bridge")
        ),
        handler: "bridge.handler",
        functionName,
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize,
        ephemeralStorageSize: diskSize,
        timeout,
        tracing,
        environment: {
          ...(props.environment || {}),
          SST_DEBUG_SRC_PATH: srcPath,
          SST_DEBUG_SRC_HANDLER: handler,
          SST_FUNCTION_ID: localId,
        },
        layers: [],
        logRetention,
        retryAttempts: 0,
        ...(debugOverrideProps || {}),
      });
      this.attachPermissions([
        new iam.PolicyStatement({
          actions: ["iot:*"],
          effect: iam.Effect.ALLOW,
          resources: ["*"],
        }),
      ]);
    }
    // Handle remove (ie. sst remove)
    else if (app.skipBuild) {
      // Note: need to override runtime as CDK does not support inline code
      //       for some runtimes.
      super(scope, id, {
        ...props,
        architecture,
        code: lambda.Code.fromInline("export function placeholder() {}"),
        handler: "index.placeholder",
        functionName,
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize,
        ephemeralStorageSize: diskSize,
        timeout,
        tracing,
        environment: props.environment,
        layers: Function.buildLayers(scope, id, props),
        logRetention,
      });
    }
    // Handle build
    else {
      super(scope, id, {
        ...props,
        architecture,
        code: lambda.Code.fromInline("export function placeholder() {}"),
        handler: "index.placeholder",
        functionName,
        runtime: lambda.Runtime.NODEJS_16_X,
        memorySize,
        ephemeralStorageSize: diskSize,
        timeout,
        tracing,
        environment: props.environment,
        layers: Function.buildLayers(scope, id, props),
        logRetention,
      });
      useDeferredTasks().add(async () => {
        // Build function
        const bundled = await Runtime.Handler.bundle({
          id: localId,
          root: app.appPath,
          handler,
          runtime,
          srcPath,
          bundle: props.bundle,
        })!;

        // Python builder returns AssetCode instead of directory
        const code = (() => {
          if ("directory" in bundled) {
            Function.copyFiles(bundle, srcPath, bundled.directory);
            return lambda.AssetCode.fromAsset(bundled.directory);
          }
          return bundled.asset;
        })();

        // Update function's code
        const codeConfig = code.bind(this);
        const cfnFunction = this.node.defaultChild as lambda.CfnFunction;
        cfnFunction.runtime = supportedRuntimes[runtime].toString();
        if (isJavaRuntime && bundle) {
          const providedRuntime = (bundle as FunctionBundleJavaProps)
            .experimentalUseProvidedRuntime;
          if (providedRuntime) {
            cfnFunction.runtime = providedRuntime;
          }
        }
        cfnFunction.code = {
          s3Bucket: codeConfig.s3Location?.bucketName,
          s3Key: codeConfig.s3Location?.objectKey,
          s3ObjectVersion: codeConfig.s3Location?.objectVersion,
        };
        cfnFunction.handler = bundled.handler;
        code.bindToResource(cfnFunction);
      });
    }

    this.id = id;
    this.props = props || {};

    if (isNodeRuntime) {
      // Enable reusing connections with Keep-Alive for NodeJs
      // Lambda function
      this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1", {
        removeInEdge: true,
      });
    }

    // Attach permissions
    this.attachPermissions(props.permissions || []);

    // Add config
    this.addEnvironment("SST_APP", app.name, { removeInEdge: true });
    this.addEnvironment("SST_STAGE", app.stage, { removeInEdge: true });
    if (FunctionBinding.ssmPrefix !== "") {
      this.addEnvironment("SST_SSM_PREFIX", FunctionBinding.ssmPrefix, { removeInEdge: true });
    }
    this.addConfig(props.config || []);
    this.bind(props.bind || []);

    this.createUrl();

    app.registerLambdaHandler({
      bundle: props.bundle!,
      handler,
      runtime,
      srcPath,
    });
    this._isLiveDevEnabled = isLiveDevEnabled;
    this.localId = localId;
  }

  /**
   * The AWS generated URL of the Function.
   */
  public get url(): string | undefined {
    return this.functionUrl?.url;
  }

  /**
   * Binds additional resources to function.
   *
   * @example
   * ```js
   * fn.bind([STRIPE_KEY, bucket]);
   * ```
   */
  public bind(constructs: SSTConstruct[]): void {
    const app = this.node.root as App;

    constructs.forEach(c => {
      // Bind environment
      const env = bindEnvironment(c);
      Object.entries(env).forEach(([key, value]) =>
        this.addEnvironment(key, value)
      );

      // Bind permissions
      const permissions = bindPermissions(c);
      Object.entries(permissions).forEach(([action, resources]) =>
        this.attachPermissions([new iam.PolicyStatement({
          actions: [action],
          effect: iam.Effect.ALLOW,
          resources,
        })])
      )
    });
  }

  /**
   * Attaches additional configs to function.
   * 
   * @deprecated The "config" prop is deprecated, and will be removed in SST v2. Pass Parameters and Secrets in through the "bind" prop. Read more about how to upgrade here — https://docs.serverless-stack.com/constructs/function
   * 
   * @example
   * ```js
   * const STRIPE_KEY = new Config.Secret(stack, "STRIPE_KEY");
   *
   * // Change
   * job.addConfig([STRIPE_KEY]);
   * 
   * // To
   * job.bind([STRIPE_KEY]);
   * ```
   */
  public addConfig(config: (Secret | Parameter)[]): void {
    const app = this.node.root as App;
    this.bind(config);

    if (config.length > 0) {
      app.reportWarning("usingConfig");
    }
  }

  /**
   * Attaches additional permissions to function.
   *
   * @example
   * ```js {20}
   * fn.attachPermissions(["s3"]);
   * ```
   */
  public attachPermissions(permissions: Permissions): void {
    // Grant IAM permissions
    if (this.role) {
      attachPermissionsToRole(this.role as iam.Role, permissions);
    }

    // Add config
    if (permissions !== "*") {
      permissions
        .filter((p) => p instanceof Job)
        .forEach((p) => this.bind([p as Job]));
    }

    // Warn user if SST constructs are passed into permissions
    if (permissions !== "*" && permissions.some((p) => isSSTConstruct(p))) {
      const app = this.node.root as App;
      app.reportWarning("usingPermissionsWithSSTConstruct");
    }
  }

  /** @internal */
  public getConstructMetadata() {
    const { config, bind } = this.props;

    return {
      type: "Function" as const,
      data: {
        localId: this.localId,
        srcPath: this.props.srcPath,
        handler: this.props.handler,
        arn: this.functionArn,
        secrets: ([...(config || []), ...(bind || [])])
          .filter((c) => c instanceof Secret)
          .map((c) => (c as Secret).name),
      },
    };
  }

  /** @internal */
  public getFunctionBinding() {
    return {
      clientPackage: "function",
      variables: {
        functionName: {
          environment: this.functionName,
          parameter: this.functionName,
        },
      },
      permissions: {
        "lambda:*": [this.functionArn],
      },
    };
  }

  private createUrl() {
    const { url } = this.props;
    if (url === false || url === undefined) {
      return;
    }

    let authType;
    let cors;
    if (url === true) {
      authType = lambda.FunctionUrlAuthType.NONE;
      cors = true;
    } else {
      authType =
        url.authorizer === "iam"
          ? lambda.FunctionUrlAuthType.AWS_IAM
          : lambda.FunctionUrlAuthType.NONE;
      cors = url.cors === undefined ? true : url.cors;
    }
    this.functionUrl = this.addFunctionUrl({
      authType,
      cors: functionUrlCors.buildCorsConfig(cors),
    });
  }

  static buildLayers(scope: Construct, id: string, props: FunctionProps) {
    return (props.layers || []).map((layer) => {
      if (typeof layer === "string") {
        return lambda.LayerVersion.fromLayerVersionArn(
          scope,
          `${id}${layer}`,
          layer
        );
      }
      return Function.handleImportedLayer(scope, layer);
    });
  }

  static normalizeMemorySize(memorySize?: number | Size): number {
    if (typeof memorySize === "string") {
      return toCdkSize(memorySize).toMebibytes();
    }
    return memorySize || 1024;
  }

  static normalizeDiskSize(diskSize?: number | Size): cdk.Size {
    if (typeof diskSize === "string") {
      return toCdkSize(diskSize);
    }
    return cdk.Size.mebibytes(diskSize || 512);
  }

  static normalizeTimeout(timeout?: number | Duration): cdk.Duration {
    if (typeof timeout === "string") {
      return toCdkDuration(timeout);
    }
    return cdk.Duration.seconds(timeout || 10);
  }

  static normalizeRuntime(runtime?: Runtime): Runtime {
    runtime = runtime || "nodejs14.x";
    if (!supportedRuntimes[runtime]) {
      throw new Error(
        `The specified runtime is not supported for sst.Function. Only NodeJS, Python, Go, and .NET runtimes are currently supported.`
      );
    }
    return runtime;
  }

  static normalizeSrcPath(srcPath: string): string {
    return srcPath.replace(/\/+$/, "");
  }

  static copyFiles(
    bundle: FunctionBundleProp | undefined,
    srcPath: string,
    buildPath: string
  ) {
    if (!bundle) return;
    if (typeof bundle === "boolean") return;
    if (!bundle.copyFiles) return;

    bundle.copyFiles.forEach((entry) => {
      const fromPath = path.join(srcPath, entry.from);
      if (!fs.existsSync(fromPath))
        throw new Error(
          `Tried to copy nonexistent file from "${path.resolve(
            fromPath
          )}" - check copyFiles entry "${entry.from}"`
        );
      const to = entry.to || entry.from;
      if (path.isAbsolute(to))
        throw new Error(`Copy destination path "${to}" must be relative`);
      const toPath = path.join(buildPath, to);
      fs.copySync(fromPath, toPath);
    });
  }

  static handleImportedLayer(
    scope: Construct,
    layer: lambda.ILayerVersion
  ): lambda.ILayerVersion {
    const layerStack = Stack.of(layer);
    const currentStack = Stack.of(scope);
    // Use layer directly if:
    // - layer is created in the current stack; OR
    // - layer is imported (ie. layerArn is a string)
    if (
      layerStack === currentStack ||
      !cdk.Token.isUnresolved(layer.layerVersionArn)
    ) {
      return layer;
    }
    // layer is created from another stack
    else {
      // set stack dependency b/c layerStack need to create the SSM first
      currentStack.addDependency(layerStack);
      // store layer ARN in SSM in layer's stack
      const parameterId = `${layer.node.id}Arn-${layer.node.addr}`;
      const parameterName = `/layers/${layerStack.node.id}/${parameterId}`;
      const existingSsmParam = layerStack.node.tryFindChild(parameterId);
      if (!existingSsmParam) {
        new ssm.StringParameter(layerStack, parameterId, {
          parameterName,
          stringValue: layer.layerVersionArn,
        });
      }
      // import layer from SSM value
      const layerId = `I${layer.node.id}-${layer.node.addr}`;
      const existingLayer = scope.node.tryFindChild(layerId);
      if (existingLayer) {
        return existingLayer as lambda.LayerVersion;
      } else {
        return lambda.LayerVersion.fromLayerVersionArn(
          scope,
          layerId,
          ssm.StringParameter.valueForStringParameter(scope, parameterName)
        );
      }
    }
  }

  static isInlineDefinition(
    definition: any
  ): definition is FunctionInlineDefinition {
    return typeof definition === "string" || definition instanceof Function;
  }

  static fromDefinition(
    scope: Construct,
    id: string,
    definition: FunctionDefinition,
    inheritedProps?: FunctionProps,
    inheritErrorMessage?: string
  ): Function {
    if (typeof definition === "string") {
      const fn = new Function(scope, id, {
        ...(inheritedProps || {}),
        handler: definition,
      });
      fn._disableBind = true;
      return fn;
    } else if (definition instanceof Function) {
      if (inheritedProps && Object.keys(inheritedProps).length > 0) {
        throw new Error(
          inheritErrorMessage ||
            `Cannot inherit default props when a Function is provided`
        );
      }
      return definition;
    } else if (definition instanceof lambda.Function) {
      throw new Error(
        `Please use sst.Function instead of lambda.Function for the "${id}" Function.`
      );
    } else if ((definition as FunctionProps).handler !== undefined) {
      const fn = new Function(
        scope,
        id,
        Function.mergeProps(inheritedProps, definition)
      );
      fn._disableBind = true;
      return fn;
    }
    throw new Error(`Invalid function definition for the "${id}" Function`);
  }

  static mergeProps(
    baseProps?: FunctionProps,
    props?: FunctionProps
  ): FunctionProps {
    // Merge environment
    const environment = {
      ...(baseProps?.environment || {}),
      ...(props?.environment || {}),
    };
    const environmentProp =
      Object.keys(environment).length === 0 ? {} : { environment };

    // Merge layers
    const layers = [...(baseProps?.layers || []), ...(props?.layers || [])];
    const layersProp = layers.length === 0 ? {} : { layers };

    // Merge config
    const config = [...(baseProps?.config || []), ...(props?.config || [])];
    const configProp = config.length === 0 ? {} : { config };

    // Merge bind
    const bind = [...(baseProps?.bind || []), ...(props?.bind || [])];
    const bindProp = bind.length === 0 ? {} : { bind };

    // Merge permissions
    let permissionsProp;
    if (baseProps?.permissions === "*") {
      permissionsProp = { permissions: baseProps.permissions };
    } else if (props?.permissions === "*") {
      permissionsProp = { permissions: props.permissions };
    } else {
      const permissions = (baseProps?.permissions || []).concat(
        props?.permissions || []
      );
      permissionsProp = permissions.length === 0 ? {} : { permissions };
    }

    return {
      ...(baseProps || {}),
      ...(props || {}),
      ...bindProp,
      ...configProp,
      ...layersProp,
      ...environmentProp,
      ...permissionsProp,
    };
  }
}
