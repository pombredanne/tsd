/*
 * imported from typescript-xm package
 *
 * Bart van der Schoor
 * https://github.com/Bartvds/typescript-xm
 * License: MIT - 2013
 * */

///<reference path="../_ref.d.ts" />
///<reference path="../../../typings/easy-table/easy-table.d.ts" />
///<reference path="../KeyValueMap.ts" />
///<reference path="../iterate.ts" />
///<reference path="../callAsync.ts" />
///<reference path="../assertVar.ts" />
///<reference path="../typeOf.ts" />
///<reference path="../ObjectUtil.ts" />
///<reference path="../Logger.ts" />
///<reference path="StyledOut.ts" />

/*
 Expose: cli command manager and help generator
 */
module xm {
	'use strict';

	var optimist = require('optimist');
	var jsesc = require('jsesc');
	var Q:typeof Q = require('q');
	//TODO ditch node-exit if node ever get fixed..
	var exitProcess:(code:number) => void = require('exit');
	//TODO ditch easy-table
	var Table:EasyTableStatic = require('easy-table');

	//TODO extract converStringMap to own file
	export var converStringMap:any = Object.create(null);

	var splitSV = /[\t ]*[,][\t ]*/g;

	converStringMap.number = function (input:string) {
		var num = parseFloat(input);
		if (isNaN(num)) {
			throw new Error('input is NaN and not float');
		}
		return num;
	};
	converStringMap.int = function (input:string) {
		var num = parseInt(input, 10);
		if (isNaN(num)) {
			throw new Error('input is NaN and not integer');
		}
		return num;
	};
	converStringMap.boolean = function (input:string) {
		input = ('' + input).toLowerCase();
		if (input === '' || input === '0') {
			return false;
		}
		switch (input) {
			case 'false':
			case 'null':
			case 'nan':
			case 'undefined':
			//language
			case 'no':
			case 'off':
			case 'disabled':
				return false;
		}
		return true;
	};
	converStringMap.flag = function (input:string) {
		if (xm.isUndefined(input) || input === '') {
			//empty flag is true
			return true;
		}
		return converStringMap.boolean(input);
	};
	converStringMap['number[]'] = function (input:string) {
		return input.split(splitSV).map((value) => {
			return converStringMap.number(value);
		});
	};
	converStringMap['int[]'] = function (input:string) {
		return input.split(splitSV).map((value) => {
			return converStringMap.int(value);
		});
	};
	converStringMap['string[]'] = function (input:string) {
		return input.split(splitSV);
	};
	converStringMap.json = function (input:string) {
		return JSON.parse(input);
	};

	export function convertStringTo(input:string, type:string):any {
		if (xm.hasOwnProp(converStringMap, type)) {
			return converStringMap[type](input);
		}
		return input;
	}

	/*
	 ExposeContext: access the parameters of a single call
	 */
	//TODO should have a reject/resolve method
	//TODO add assertion mode (hardcore verification for dev/test)
	export class ExposeContext {

		expose:Expose;
		command:ExposeCommand;
		argv:any;
		out:xm.StyledOut;

		constructor(expose:Expose, argv, command?:ExposeCommand) {
			this.expose = expose;
			this.command = command;
			this.argv = argv;
			this.out = this.expose.output;
		}

		hasOpt(name:string, strict:boolean = false):any {
			if (xm.hasOwnProp(this.argv, name)) {
				if (strict && !this.expose.options.has(name)) {
					return false;
				}
				return true;
			}
			return false;
		}

		getOptRaw(name:string, alt?:any):any {
			if (xm.hasOwnProp(this.argv, name)) {
				return this.argv[name];
			}
			return alt;
		}

		getOpt(name:string, alt?:any):any {
			if (this.hasOpt(name)) {
				var option = this.expose.options.get(name);
				if (option && !xm.isUndefined(option.default)) {
					if (option.type) {
						// unhack optimist flags
						if (typeof this.argv[name] === 'boolean' && (option.type !== 'boolean' && option.type !== 'flag')) {
							return this.getDefault(name, xm.convertStringTo(this.argv[name], option.type));
						}
						return xm.convertStringTo(this.argv[name], option.type);
					}
				}
				return this.argv[name];
			}
			return this.getDefault(name, alt);
		}

		getOptAs(name:string, type:string, alt?:any):any {
			if (this.hasOpt(name)) {
				return xm.convertStringTo(this.argv[name], type);
			}
			return this.getDefault(name, alt);
		}

		getOptNames(strict:boolean = false):string[] {
			return Object.keys(this.argv).filter((name:string) => {
				return (name !== '_' && this.hasOpt(name, strict));
			});
		}

		getOptEnum(name:string, alt?:any):any {
			if (this.hasOpt(name)) {
				if (this.expose.options.has(name)) {
					var option = this.expose.options.get(name);
					var value = this.getOpt(name);
					if (option.enum && option.enum.indexOf(value) > -1) {
						return value;
					}
				}
			}
			return alt;
		}

		getDefault(name:string, alt?:any):any {
			var option = this.expose.options.get(name);
			if (option && !xm.isUndefined(option.default)) {
				return option.default;
			}
			return alt;
		}

		isDefault(name:string):boolean {
			if (this.hasOpt(name, true)) {
				var def = this.expose.options.get(name).default;
				if (!xm.isUndefined(def)) {
					return (def === this.getOpt(name));
				}
			}
			return false;
		}

		getArgAt(index:number, alt?:any):any {
			if (index >= 0 && index < this.argv._.length) {
				return this.argv._[index];
			}
			return alt;
		}

		//(booya!)
		getArgAtAs(index:number, type:string, alt?:any):any {
			if (index >= 0 && index < this.argv._.length) {
				return xm.convertStringTo(this.argv._[index], type);
			}
			return alt;
		}

		//(gasp!)
		getArgsAs(type:string):any[] {
			return this.argv._.map((value:string) => {
				return xm.convertStringTo(value, type);
			});
		}

		shiftArg(alt?:string):any {
			if (this.argv._.length > 0) {
				return this.argv._.shift();
			}
			return alt;
		}

		shiftArgAs(type:string, alt?:string):any {
			if (this.argv._.length > 0) {
				return xm.convertStringTo(this.argv._.shift(), type);
			}
			return alt;
		}

		getArgs(alt?:string):any {
			if (this.argv._.length > 0) {
				return this.argv._.shift();
			}
			return alt;
		}

		get numArgs():number {
			return this.argv._.length;
		}
	}

	export interface ExposeHook {
		(ctx:ExposeContext):any;
	}

	//TODO add ExposeCommand/ExposeContext (like ExposeHook)?
	export interface ExposeOptionApply {
		(value:any, ctx:ExposeContext):void;
	}

	export interface ExposeResult {
		code:number;
		ctx:ExposeContext;
		error:ExposeError;
	}

	//TODO add some extra properties?
	export interface ExposeError extends Error {
	}

	export interface ExposeSorter {
		(one:ExposeCommand, two:ExposeCommand):number;
	}

	export function exposeSortIndex(one:ExposeCommand, two:ExposeCommand):number {
		if (one.index < two.index) {
			return -1;
		}
		else if (one.index > two.index) {
			return 1;
		}
		if (one.name < two.name) {
			return -1;
		}
		else if (one.name > two.name) {
			return 1;
		}
		return 0;
	}

	export function exposeSortHasElem(one:any[], two:any[], elem:any):number {
		var oneI = one.indexOf(elem) > -1;
		var twoI = two.indexOf(elem) > -1;
		if (oneI && !twoI) {
			return -1;
		}
		else if (!oneI && twoI) {
			return 1;
		}
		return 0;
	}

	export function exposeSortId(one:ExposeCommand, two:ExposeCommand):number {
		if (one.name < two.name) {
			return -1;
		}
		else if (one.name > two.name) {
			return 1;
		}
		if (one.index < two.index) {
			return -1;
		}
		else if (one.index > two.index) {
			return 1;
		}
		return 0;
	}

	export function exposeSortGroup(one:ExposeGroup, two:ExposeGroup):number {
		if (one.index < two.index) {
			return -1;
		}
		else if (one.index > two.index) {
			return 1;
		}
		if (one.name < two.name) {
			return -1;
		}
		else if (one.name > two.name) {
			return 1;
		}
		return 0;
	}

	export function exposeSortOption(one:ExposeOption, two:ExposeOption):number {
		if (one.short && !two.short) {
			return -1;
		}
		if (!one.short && two.short) {
			return 1;
		}
		if (one.short && two.short) {
			if (one.short.toLowerCase() < two.short.toLowerCase()) {
				return -1;
			}
			else if (one.short.toLowerCase() > two.short.toLowerCase()) {
				return 1;
			}
		}
		if (one.name.toLowerCase() < two.name.toLowerCase()) {
			return -1;
		}
		else if (one.name.toLowerCase() > two.name.toLowerCase()) {
			return 1;
		}
		return 0;
	}

	export class ExposeCommand {
		name:string;
		execute:ExposeHook;
		index:number;

		label:string;
		options:string[] = [];
		variadic:string[] = [];
		groups:string[] = [];
		note:string[] = [];
		internal:boolean;

		constructor() {
		}
	}

	export class ExposeGroup {
		name:string;
		label:string;
		index:number;
		sorter:ExposeSorter = exposeSortIndex;
		options:string[] = [];

		constructor() {
		}
	}

	export class ExposeOption {
		name:string;
		description:string;
		short:string;
		type:string;
		placeholder:string;
		default:any;
		command:string;
		global:boolean = false;
		//TODO implement optional
		optional:boolean = true;
		enum:any[] = [];
		note:string[] = [];
		//TODO implement example
		example:string[] = [];
		apply:ExposeOptionApply;
	}

	/*
	 Expose: cli command manager, wraps optimist with better usage generator and other utils
	 */
	//TODO add detail level switch
	//TODO add per-command sub-help like npm
	//TODO add more/less flag
	//TODO add feature for printable placeholder sub-info (format etc)
	//TODO unify Actions and Commands (same thing really)
	//TODO implement action queues
	export class Expose {

		commands = new KeyValueMap<ExposeCommand>();
		options = new KeyValueMap<ExposeOption>();
		groups = new KeyValueMap<ExposeGroup>();
		mainGroup = new ExposeGroup();

		private _isInit = false;
		private _index = 0;

		output:xm.StyledOut;

		before:ExposeHook;
		after:ExposeHook;

		constructor(public title:string = '', output:xm.StyledOut = null) {
			this.output = (output || new xm.StyledOut());

			this.defineCommand((cmd:ExposeCommand) => {
				cmd.name = 'help';
				cmd.label = 'display usage help';
				cmd.groups = ['help'];
				cmd.execute = (ctx:xm.ExposeContext) => {
					this.printCommands();
					return null;
				};
			});

			this.defineOption((opt:ExposeOption) => {
				opt.name = 'help';
				opt.short = 'h';
				opt.description = 'display usage help';
				opt.type = 'flag';
				opt.command = 'help';
				opt.global = true;
			});

			xm.ObjectUtil.defineProps(this, ['commands', 'options', 'groups', 'mainGroup'], {
				writable: false,
				enumerable: false
			});
		}

		defineOption(build:(opt:ExposeOption) => void) {
			var opt = new ExposeOption();
			build(opt);

			if (opt.type === 'flag' && xm.isUndefined(opt.default)) {
				opt.default = false;
			}

			xm.assertVar(opt.name, 'string', 'opt.name');

			if (this.options.has(opt.name)) {
				throw new Error('opt.name collision on ' + opt.name);
			}
			this.options.set(opt.name, opt);
		}

		defineCommand(build:(cmd:ExposeCommand) => void):void {
			var cmd = new ExposeCommand();
			build(cmd);
			cmd.index = (++this._index);

			xm.assertVar(cmd.name, 'string', 'build.name');

			if (this.commands.has(cmd.name)) {
				throw new Error('cmd.name collision on ' + cmd.name);
			}
			this.commands.set(cmd.name, cmd);
		}

		defineGroup(build:(group:ExposeGroup) => void):void {
			var group = new ExposeGroup();
			build(group);
			group.index = (++this._index);

			xm.assertVar(group.name, 'string', 'group.name');

			if (this.groups.has(group.name)) {
				throw new Error('group.name collision on ' + group.name);
			}
			this.groups.set(group.name, group);
		}

		applyOptions(argv:any):ExposeContext {
			argv = optimist.parse(argv);
			var ctx = new ExposeContext(this, argv, null);

			ctx.getOptNames(true).forEach((name:string) => {
				var opt = this.options.get(name);
				if (opt.apply) {
					opt.apply(ctx.getOpt(name), ctx);
				}
			});
			return ctx;
		}

		init():void {
			if (this._isInit) {
				return;
			}
			this._isInit = true;

			xm.eachProp(this.options.keys(), (name) => {
				var option:ExposeOption = this.options.get(name);
				if (option.short) {
					optimist.alias(option.name, option.short);
				}
				//TODO get rid of optimist's defaults
				/*if (!xm.isUndefined(option.default)) {
				 optimist.default(option.name, option.default);
				 }
				 else {
				 if (option.type === 'flag') {
				 optimist.default(option.name, false);
				 }
				 else {
				 optimist.default(option.name, null);
				 }
				 }*/
			});

			this.groups.values().forEach((group:xm.ExposeGroup) => {
				this.validateOptions(group.options);
			});

			this.commands.values().forEach((cmd:xm.ExposeCommand) => {
				this.validateOptions(cmd.options);
			});
		}

		validateOptions(opts:string[]):void {
			opts.forEach((name:string) => {
				xm.assert(this.options.has(name), 'undefined option {a}', name);
			});
		}

		exit(code:number):void {
			if (code !== 0) {
				this.output.ln().error('Closing with exit code ' + code).clear();
				//this.output.ln().fail('error');
			}
			else {
				//this.output.ln().success('Closing with exit code ' + code).clear();
				//this.output.ln().ok('bye!');
			}
			exitProcess(code);
		}

		//execute and exit
		executeArgv(argvRaw:any, alt?:string, exitAfter:boolean = true):void {
			Q(this.executeRaw(argvRaw, alt).then((result:ExposeResult) => {
				if (result.error) {
					throw(result.error);
				}
				if (exitAfter) {
					this.exit(result.code);
				}
			}).fail((err) => {
				//TODO what to do? with final error?
				if (err.stack) {
					this.output.span(err.stack).clear();
				}
				else {
					this.output.error(err.toString()).clear();
				}
				this.exit(1);
			}));
		}

		//parse and execute args, promise result
		executeRaw(argvRaw:any, alt?:string):Q.Promise<ExposeResult> {
			this.init();

			if (!alt || !this.commands.has(alt)) {
				alt = 'help';
			}

			var options:ExposeOption[] = this.options.values();
			var opt:ExposeOption;
			var i:number, ii:number;

			var ctx = this.applyOptions(argvRaw);
			if (!ctx) {
				return this.executeCommand(alt);
			}

			//command options (option that takes priority, like --version etc)
			for (i = 0, ii = options.length; i < ii; i++) {
				opt = options[i];
				if (opt.command && ctx.hasOpt(opt.name, true)) {
					return this.executeCommand(opt.command, ctx);
				}
			}

			//clean argv 'bin' padding
			//node
			var cmd = ctx.shiftArg();
			//script
			cmd = ctx.shiftArg();
			if (ctx.numArgs === 0) {
				//this.output.warning('undefined command').clear();
				return this.executeCommand(alt, ctx);
			}
			//command
			cmd = ctx.shiftArg();
			if (this.commands.has(cmd)) {
				// actual command
				return this.executeCommand(cmd, ctx);
			}
			else {
				this.output.ln().warning('command not found: ' + cmd).clear();
				return this.executeCommand('help', ctx);
			}
		}

		//execute command, promise result
		executeCommand(name:string, ctx:xm.ExposeContext = null):Q.Promise<ExposeResult> {
			this.init();

			if (!this.commands.has(name)) {
				return Q({
					code: 1,
					error: new Error('unknown command ' + name)
				});
			}
			var cmd:ExposeCommand = this.commands.get(name);

			var defer:Q.Deferred<ExposeResult> = Q.defer();

			Q.resolve().then(() => {
				if (this.before) {
					return Q(this.before(ctx));
				}
				return null;
			}).then(() => {
				return Q(cmd.execute(ctx));
			}).then(() => {
				if (this.after) {
					return Q(this.after(ctx));
				}
				return null;
			}).then(() => {
				return {
					code: 0,
					ctx: ctx
				};
			}, (err) => {
				return {
					code: (err.code && err.code > 0) ? err.code : 1,
					error: err,
					ctx: ctx
				};
			}).done((ret:ExposeResult) => {
				defer.resolve(ret);
			});

			return defer.promise;
		}

		//TODO replace easy-tables with layout that supports colored/wrapped/non-printable output
		printCommands():void {
			if (this.title) {
				this.output.accent(this.title).clear();
			}

			var optionString = (option:ExposeOption):string => {
				var placeholder = option.placeholder ? ' <' + option.placeholder + '>' : '';
				return '--' + option.name + placeholder;
				//return (option.short ? '-' + option.short + ', ' : '') + '--' + option.name + placeholder;
			};

			var commands = new Table();

			var commandOptNames:string[] = [];
			var globalOptNames:string[] = [];
			var commandPadding:string = '   ';
			var optPadding:string = '      ';
			var optPaddingHalf:string = ' : ';

			var sortOptionName = (one:string, two:string) => {
				return exposeSortOption(this.options.get(one), this.options.get(two));
			};

			var optKeys = this.options.keys().sort(sortOptionName);

			var addHeader = (label:string) => {
				commands.cell('one', label);
				commands.newRow();
				addDivider();
			};

			var addDivider = () => {
				commands.cell('one', '--------');
				commands.cell('short', '----');
				commands.cell('two', '--------');
				commands.newRow();
			};

			var addOption = (name:string) => {
				var option:ExposeOption = this.options.get(name, null);
				if (!option) {
					commands.cell('one', optPadding + '--' + name);
					commands.cell('two', optPaddingHalf + '<undefined>');
				}
				else {
					commands.cell('one', optPadding + optionString(option));
					if (option.short) {
						commands.cell('short', ' -' + option.short);
					}
					var desc = optPaddingHalf + option.description;
					desc += ' (' + option.type;
					desc += (option.default ? ', default: ' + option.default : '');
					desc += ')';
					commands.cell('two', desc);

					if (option.enum.length > 0) {
						commands.newRow();
						commands.cell('two', '   ' + option.enum.map((value:any) => {
							if (xm.isNumber(value)) {
								return value;
							}
							var str = ('' + value);
							if (/^[\w_-]*$/.test(str)) {
								return str;
							}
							return '\'' + jsesc(('' + value), {
								quotes: 'single'
							}) + '\'';
						}).join(','));

					}
				}
				commands.newRow();

				addNote(option.note);
			};

			var addCommand = (cmd:ExposeCommand, group:ExposeGroup) => {
				var usage = cmd.name;
				if (cmd.variadic.length > 0) {
					usage += ' <' + cmd.variadic.join(', ') + '>';
				}
				commands.cell('one', commandPadding + usage);
				commands.cell('two', cmd.label);
				commands.newRow();

				addNote(cmd.note);

				cmd.options.sort(sortOptionName).forEach((name:string) => {
					if (commandOptNames.indexOf(name) < 0 && group.options.indexOf(name) < 0) {
						addOption(name);
					}
				});
				//commands.newRow();
			};

			var addNote = (note:string[]) => {
				if (note && note.length > 0) {
					note.forEach((note:string) => {
						commands.cell('two', '   <' + note + '>');
						commands.newRow();
					});
				}
			};

			var allCommands = this.commands.keys();
			var allGroups = this.groups.values();

			optKeys.forEach((name:string) => {
				var option:ExposeOption = this.options.get(name);
				if (option.command) {
					//addOption(option);
					commandOptNames.push(option.name);
				}
			});
			//commands.newRow();
			optKeys.forEach((name:string) => {
				var option:ExposeOption = this.options.get(name);
				if (option.global && !option.command) {
					//addOption(option);
					globalOptNames.push(option.name);
				}
			});

			if (allGroups.length > 0) {
				this.groups.values().sort(exposeSortGroup).forEach((group:ExposeGroup) => {
					addHeader(group.label);

					this.commands.values().filter((cmd:ExposeCommand) => {
						return cmd.groups.indexOf(group.name) > -1;

					}).sort(group.sorter).forEach((cmd:ExposeCommand) => {
						addCommand(cmd, group);

						var i = allCommands.indexOf(cmd.name);
						if (i > -1) {
							allCommands.splice(i, 1);
						}
					});

					if (group.options.length > 0) {
						addDivider();
						group.options.sort(sortOptionName).forEach((name:string) => {
							if (commandOptNames.indexOf(name) < 0) {
								addOption(name);
							}
						});
					}
					commands.newRow();
					//xm.eachProp(this.commands.keys().sort(), (name) => {});
				});
			}

			if (allCommands.length > 0) {
				addHeader('other commands');

				allCommands.forEach((name) => {
					addCommand(this.commands.get(name), this.mainGroup);
				});
				commands.newRow();
			}

			if (commandOptNames.length > 0 && globalOptNames.length > 0) {
				addHeader('global options');

				if (commandOptNames.length > 0) {
					xm.eachElem(commandOptNames, (name:string) => {
						addOption(name);
					});
				}

				if (globalOptNames.length > 0) {
					xm.eachElem(globalOptNames, (name:string) => {
						addOption(name);
					});
				}
				commands.newRow();
			}
			//now output

			//TODO get rid of this nasty trim (ditch easy-table)
			this.output.block(commands.print().replace(/\s*$/, ''));
		}
	}
}