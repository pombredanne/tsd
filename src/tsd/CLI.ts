///<reference path="_ref.ts" />
///<reference path="../xm/Logger.ts" />
///<reference path="../xm/io/Expose.ts" />
///<reference path="../xm/io/FileUtil.ts" />
///<reference path="../xm/io/StyledOut.ts" />
///<reference path="../xm/DateUtil.ts" />
///<reference path="../xm/ObjectUtil.ts" />
///<reference path="../xm/promise.ts" />
///<reference path="context/Context.ts" />
///<reference path="select/Query.ts" />
///<reference path="cli/options.ts" />
///<reference path="cli/const.ts" />

module tsd {
	'use strict';

	var path = require('path');
	var Q = require('q');
	var FS:typeof QioFS = require('q-io/fs');

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	var Opt = tsd.cli.Opt;
	var Group = tsd.cli.Group;
	var Action = tsd.cli.Action;

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	var output = new xm.StyledOut();

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export var styleMap = new xm.KeyValueMap<(ctx:xm.ExposeContext) => void>();

	styleMap.set('no', (ctx:xm.ExposeContext) => {
		output.useStyler(new xm.styler.NoStyler());
	});
	styleMap.set('plain', (ctx:xm.ExposeContext) => {
		output.useStyler(new xm.styler.PlainStyler());
	});
	styleMap.set('ansi', (ctx:xm.ExposeContext) => {
		output.useStyler(new xm.styler.ANSIStyler());
	});
	styleMap.set('html', (ctx:xm.ExposeContext) => {
		output.useStyler(new xm.styler.HTMLWrapStyler());
	});
	styleMap.set('css', (ctx:xm.ExposeContext) => {
		output.useStyler(new xm.styler.CSSStyler());
	});
	styleMap.set('dev', (ctx:xm.ExposeContext) => {
		output.useStyler(new xm.styler.DevStyler());
	});

	export function useColor(color:string, ctx:xm.ExposeContext) {
		if (styleMap.has(color)) {
			styleMap.get(color)(ctx);
		}
		else {
			styleMap.get('no')(ctx);
		}
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	function printPreviewNotice():Q.Promise<void> {
		var pkg = xm.PackageJSON.getLocal();

		output.ln()
		.report(true).span(pkg.getNameVersion()).space().accent('(preview)').ln()
			//.clear().span(pkg.getHomepage(true)).ln()
		.ruler().ln();
		//TODO implement version check / news service
		return Q.resolve();
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	var pleonasm;
	var pleonasmPromise;

	function loadPleonasm():Q.Promise<void> {
		if (pleonasmPromise) {
			return pleonasmPromise;
		}

		return Q.resolve();

		/*var d:Q.Deferred<void> = Q.defer();
		 pleonasmPromise = d.promise;

		 pleonasm = require('pleonasm');
		 pleonasm.onload = () => {
		 xm.log('pleonasm.onload');
		 d.resolve();
		 };
		 return d.promise;*/
	}

	function pleo(input) {
		input = input.substring(0, 6);
		if (pleonasm) {
			return '\'' + pleonasm.encode(input, '_', '_').code + '\'';
		}
		else {
			return input;
		}
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	function getContext(ctx:xm.ExposeContext):tsd.Context {
		xm.assertVar(ctx, xm.ExposeContext, 'ctx');

		var context = new tsd.Context(ctx.getOpt(Opt.config), ctx.getOpt(Opt.verbose));

		if (ctx.getOpt(Opt.dev)) {
			context.paths.cacheDir = path.resolve(path.dirname(xm.PackageJSON.find()), tsd.Const.cacheDir);
		}
		else if (ctx.hasOpt(Opt.cacheDir)) {
			context.paths.cacheDir = path.resolve(ctx.getOpt(Opt.cacheDir));
		}
		else {
			context.paths.cacheDir = tsd.Paths.getUserCacheDir();
		}
		return context;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	//TODO further unify reporting format (consistent details and don't rely on toString()'s) (See TODO.md)

	function reportError(err:any, head:boolean = true):xm.StyledOut {
		if (head) {
			output.info().error('an error occured!').clear();
		}

		if (err.stack) {
			return output.block(err.stack);
		}
		return output.line(err);
	}

	function reportProgress(obj:any):xm.StyledOut {
		return output.info().inspect(obj, 3);
	}

	function reportSucces(result:tsd.APIResult):xm.StyledOut {
		//output.ln().info().success('success!').clear();
		if (result) {
			result.selection.forEach((def:tsd.DefVersion) => {
				output.line(def.toString());
				if (def.info) {
					output.line(def.info.toString());
					output.line(def.info);
				}
			});
		}
		return output;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	function printFile(file:tsd.DefVersion, sep:string = ' : '):xm.StyledOut {
		if (file.def) {
			output.span(file.def.path);
		}
		else {
			output.accent('<no def>');
		}
		return output.accent(sep).glue(printFileEnd(file, sep));
	}

	function printFileEnd(file:tsd.DefVersion, sep:string = ' | '):xm.StyledOut {
		if (file.def && file.def.head === file) {
			output.span('<head>');
			if (file.commit.changeDate) {
				output.accent(sep).span(xm.DateUtil.toNiceUTC(file.commit.changeDate));
			}
		}
		else {
			if (file.commit) {
				output.span(file.commit.commitShort);
				if (file.commit.changeDate) {
					output.accent(sep).span(xm.DateUtil.toNiceUTC(file.commit.changeDate));
				}
			}
			else {
				output.accent(sep).accent('<no commit>');
			}
		}
		/*if (file.blob) {
		 output.span(sep).span(file.blob.shaShort);
		 }*/
		return output;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	function printFileCommit(file:tsd.DefVersion, skipNull:boolean = false):xm.StyledOut {
		var sep = '  |  ';
		if (file.commit) {
			output.indent().glue(printFileEnd(file, sep));
			output.accent(sep).span(file.commit.gitAuthor.name);
			if (file.commit.hubAuthor) {
				output.accent('  @  ').span(file.commit.hubAuthor.login);
			}
			output.clear();

			//TODO full indent message
			output.indent().line(file.commit.message.subject);
			output.ln();
		}
		else if (!skipNull) {
			output.indent().accent('<no commmit>');
			output.ln();
		}
		return output;
	}

	function printSubHead(text:string):xm.StyledOut {
		return output.line(' ' + text).ln();
	}

	function printDefHead(def:tsd.Def):xm.StyledOut {
		return output.line(def.toString()).ln();
	}

	function printFileHead(file:tsd.DefVersion):xm.StyledOut {
		return output.info(true).glue(printFile(file)).ln().ln();
	}

	function printFileInfo(file:tsd.DefVersion, skipNull:boolean = false):xm.StyledOut {
		if (file.info) {
			if (file.info.isValid()) {
				output.indent().line(file.info.toString());
				output.indent().indent().line(file.info.projectUrl);
				file.info.authors.forEach((author:xm.AuthorInfo) => {
					output.indent().indent().line(author.toString());
				});
				output.ln();
			}
			else {
				output.indent().accent('<invalid info>');
				output.clear();
			}
		}
		else if (!skipNull) {
			output.indent().accent('<no info>');
			output.clear();
		}
		return output;
	}

	function printDependencies(file:tsd.DefVersion):xm.StyledOut {
		if (file.dependencies.length > 0) {

			tsd.DefUtil.mergeDependenciesOf(file.dependencies).filter((refer:tsd.DefVersion) => {
				return refer.def.path !== file.def.path;
			}).sort(tsd.DefUtil.fileCompare).forEach((refer:tsd.DefVersion) => {
				output.indent().report(true).glue(printFile(refer)).ln();

				if (refer.dependencies.length > 0) {
					refer.dependencies.sort(tsd.DefUtil.defCompare).forEach((dep:tsd.Def) => {
						output.indent().indent().report(true).line(dep.path);
					});
				}
			});
			output.ln();
		}
		return output;
	}

	function printInstallResult(result:tsd.InstallResult):xm.StyledOut {
		//TODO fix pluralised reporting
		if (result.written.keys().length === 0) {
			output.ln().report(true).span('written ').accent('zero').span(' files').ln();
		}
		else if (result.written.keys().length === 1) {
			output.ln().report(true).span('written ').accent(result.written.keys().length).span(' file:').clear();
		}
		else {
			output.ln().report(true).span('written ').accent(result.written.keys().length).span(' files:').clear();
		}

		//TODO report on written/skipped
		result.written.keys().sort().forEach((path:string) => {
			var file:tsd.DefVersion = result.written.get(path);
			output.bullet(true).glue(printFile(file)).ln();
		});
		output.ln().report().span('install').space().success('success!').ln();
		return output;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	//very basic (async) init stuff
	function init(ctx:xm.ExposeContext):Q.Promise<void> {
		return loadPleonasm();
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	//dry helpers: reuse / bundle init and arg parsing for query based commands

	var defaultJobOptions = [Opt.config];

	function jobOptions(merge:string[] = []):string[] {
		return defaultJobOptions.concat(merge);
	}

	//bundle some data
	export class Job {
		api:tsd.API;
		context:tsd.Context;
		query:Query;
		options:Options;
	}

	//hah!
	export interface JobSelectionAction {
		(ctx:xm.ExposeContext, job:Job, selection:tsd.Selection):Q.Promise<any>;
	}


	//get a API with a Context and parse basic arguments
	function getAPIJob(ctx:xm.ExposeContext):Q.Promise<Job> {
		var d:Q.Deferred<Job> = Q.defer();

		init(ctx).then(() => {
			//verify valid path
			if (ctx.hasOpt(Opt.config, true)) {
				return FS.isFile(ctx.getOpt(Opt.config)).then((isFile:boolean) => {
					if (!isFile) {
						throw new Error('specified --config is not a file: ' + ctx.getOpt(Opt.config));
					}
					return null;
				});
			}
			return null;
		}).then(() => {
			var job = new Job();
			job.context = getContext(ctx);
			job.api = new tsd.API(job.context);

			job.options = new tsd.Options();

			job.options.timeout = ctx.getOpt(Opt.timeout);
			job.options.limitApi = ctx.getOpt(Opt.limit);
			job.options.minMatches = ctx.getOpt(Opt.min);
			job.options.maxMatches = ctx.getOpt(Opt.max);

			job.options.saveToConfig = ctx.getOpt(Opt.save);
			job.options.overwriteFiles = ctx.getOpt(Opt.overwrite);
			job.options.resolveDependencies = ctx.getOpt(Opt.resolve);

			var required:boolean = ctx.hasOpt(Opt.config);

			return job.api.readConfig(!required).progress(d.notify).then(() => {
				d.resolve(job);
			});
		}).fail(d.reject);

		return d.promise;
	}

	//get a API and parse selector options
	function getSelectorJob(ctx:xm.ExposeContext):Q.Promise<Job> {
		var d:Q.Deferred<Job> = Q.defer();

		// callback for easy error reporting
		getAPIJob(ctx).progress(d.notify).then((job:Job) => {
			if (ctx.numArgs < 1) {
				throw new Error('pass at least one query pattern');
			}
			job.query = new Query();
			for (var i = 0, ii = ctx.numArgs; i < ii; i++) {
				job.query.addNamePattern(ctx.getArgAt(i));
			}
			job.query.commitSha = ctx.getOpt(Opt.commit);

			if (ctx.hasOpt(Opt.semver)) {
				job.query.versionMatcher = new tsd.VersionMatcher(ctx.getOpt(Opt.semver));
			}
			if (ctx.hasOpt(Opt.date)) {
				job.query.dateMatcher = new tsd.DateMatcher(ctx.getOpt(Opt.date));
			}

			job.query.parseInfo = ctx.getOpt(Opt.info);
			job.query.loadHistory = ctx.getOpt(Opt.history);

			if (ctx.getOptAs(Opt.verbose, 'boolean')) {
				output.span('CLI job.query').info().inspect(job.query, 3);
			}
			return job;
		}).then(d.resolve, d.reject);

		return d.promise;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	export function getExpose():xm.Expose {

		var expose = new xm.Expose('', output);

		function getProgress(ctx) {
			if (ctx.getOpt(Opt.progress)) {
				return function (note) {
					reportProgress(note);
				};
			}
			return undefined;
		}

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		expose.before = (cmd:xm.ExposeCommand, ctx:xm.ExposeContext) => {
			return printPreviewNotice();
		};

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		expose.defineGroup((group:xm.ExposeGroup) => {
			group.name = Group.query;
			group.label = 'Main commands';
			group.options = [Opt.config, Opt.cacheDir, Opt.min, Opt.max, Opt.limit];
			group.sorter = (one:xm.ExposeCommand, two:xm.ExposeCommand):number => {
				var sort:number;
				//TODO sane-ify sorting groups
				sort = xm.exposeSortHasElem(one.groups, two.groups, Group.query);
				if (sort !== 0) {
					return sort;
				}
				sort = xm.exposeSortHasElem(one.groups, two.groups, Group.support);
				if (sort !== 0) {
					return sort;
				}
				sort = xm.exposeSortHasElem(one.groups, two.groups, Group.help);
				if (sort !== 0) {
					return sort;
				}
				return xm.exposeSortIndex(one, two);
			};
		});

		expose.defineGroup((group:xm.ExposeGroup) => {
			group.name = Group.support;
			group.label = 'Support commands';
			group.options = [Opt.config, Opt.cacheDir];
		});

		expose.defineGroup((group:xm.ExposeGroup) => {
			group.name = Group.help;
			group.label = 'Help commands';
		});

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		// bulk add options
		tsd.cli.addOptions(expose);

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		expose.defineCommand((cmd:xm.ExposeCommand) => {
			cmd.name = 'version';
			cmd.label = 'Display version';
			cmd.groups = [Group.help];
			cmd.execute = ((ctx:xm.ExposeContext) => {
				return output.line(xm.PackageJSON.getLocal().version);
			});
		});

		expose.defineCommand((cmd:xm.ExposeCommand) => {
			cmd.name = 'init';
			cmd.label = 'Create empty config file';
			cmd.options = [Opt.config, Opt.overwrite];
			cmd.groups = [Group.support];
			cmd.execute = (ctx:xm.ExposeContext) => {
				return getAPIJob(ctx).then((job:Job) => {
					return job.api.initConfig(ctx.getOpt(Opt.overwrite)).progress(getProgress(ctx)).then((target:string) => {
						output.info().success('written ').span(target).clear();
					}, (err) => {
						output.info().error('error ').span(err.message).clear();
						throw(err);
					});
				}, reportError, getProgress(ctx));
			};
		});

		expose.defineCommand((cmd:xm.ExposeCommand) => {
			cmd.name = 'settings';
			cmd.label = 'Display config settings';
			cmd.options = [Opt.config, Opt.cacheDir];
			cmd.groups = [Group.support];
			cmd.execute = (ctx:xm.ExposeContext) => {
				return getAPIJob(ctx).then((job:Job) => {
					return <any> job.api.context.logInfo(true);

				}, reportError, getProgress(ctx));
			};
		});

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		//TODO abstractify this
		var queryActions = new xm.ActionMap<tsd.JobSelectionAction>();
		queryActions.set(Action.install, (ctx:xm.ExposeContext, job:Job, selection:tsd.Selection) => {
			return job.api.install(selection, job.options).then((result:tsd.InstallResult) => {
				printInstallResult(result);
			});
		});
		/*queryActions.set(Action.open, (ctx:xm.ExposeContext, job:Job, selection:tsd.Selection) => {
		 return job.api.install(selection);
		 });*/

		expose.defineCommand((cmd:xm.ExposeCommand) => {
			cmd.name = 'query';
			cmd.label = 'Search definitions';
			cmd.variadic = ['pattern'];
			cmd.groups = [Group.primary, Group.query];
			cmd.options = [
				Opt.info, Opt.history,
				Opt.semver, Opt.date, Opt.commit,
				Opt.action,
				Opt.resolve, Opt.overwrite, Opt.save
			];
			cmd.execute = (ctx:xm.ExposeContext) => {
				var notify = getProgress(ctx);
				return getSelectorJob(ctx).then((job:Job) => {
					return job.api.select(job.query, job.options).progress(notify).then((selection:tsd.Selection) => {
						if (selection.selection.length === 0) {
							output.ln().report().warning('zero results').clear();
						} else {
							//TODO report on written/skipped
							selection.selection.forEach((file:tsd.DefVersion) => {
								//printFile(file, true);
								printFileHead(file);
								printFileInfo(file, true);

								printDependencies(file);

								file.def.history.slice(0).forEach((file:tsd.DefVersion) => {
									printFileCommit(file);
								});
							});

							//run actions
							return Q().then(() => {
								//get as arg
								var action = ctx.getOpt(Opt.action);
								if (!action) {
									//output.ln().report().warning('no action').ln();
									return;
								}
								if (!queryActions.has(action)) {
									output.ln().report().warning('unknown action:').space().span(action).ln();
									return;
								}
								output.ln().info().span('running:').space().accent(action).ln();
								return queryActions.run(action, (run:tsd.JobSelectionAction) =>  {
									return run(ctx, job, selection).progress(notify);
								}, true).then(() => {
									//whut?
								}, (err) => {
									output.ln().report().span(action).space().error('error!').ln();
									reportError(err, false);
								}, getProgress(ctx));
							});
						}
					});
				}, reportError, notify);
			};
		});

		// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

		expose.defineCommand((cmd:xm.ExposeCommand) => {
			cmd.name = 'reinstall';
			cmd.label = 'Re-install definitions from config';
			cmd.options = [Opt.overwrite];
			cmd.groups = [Group.support];
			cmd.execute = (ctx:xm.ExposeContext) => {
				return getAPIJob(ctx).then((job:Job) => {
					return job.api.reinstall(job.options).progress(getProgress(ctx)).then((result:tsd.InstallResult) => {
						printInstallResult(result);
					});
				}, reportError, getProgress(ctx));
			};
		});

		return expose;
	}

	// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

	/*
	 runARGV: run raw cli arguments, like process.argv
	 */
	export function runARGV(argvRaw:any) {
		getExpose().executeArgv(argvRaw, 'help');
	}
}
