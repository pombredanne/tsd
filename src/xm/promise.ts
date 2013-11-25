///<reference path="../_ref.d.ts" />
///<reference path="KeyValueMap.ts" />
///<reference path="assertVar.ts" />

module xm {

	//TODO add interesting helpers based on weak-map

	var Q = require('q');

	export class ActionMap<T> extends xm.KeyValueMap<T> {

		constructor(data?:any) {
			super(data);
		}

		run(id:string, call:(value:T) => any, optional:boolean = false):Q.Promise<T> {
			if (this.has(id)) {
				//cast as any
				return Q(call(this.get(id)));
			}
			else if (!optional) {
				return Q.reject(new Error('missing action: ' + id));
			}
			return Q();
		}

		//TODO verify progress/notify bubbles correctly
		runSerial(ids:string[], call:(value:T) => any, optional:boolean = false):Q.Promise<T> {
			var queue = ids.slice(0);

			var defer:Q.Deferred<T> = Q.defer();

			var runOne = (value?:T) => {
				if (queue.length > 0) {
					return this.run(queue.pop(), call, optional).progress(defer.notify).then(runOne);
				}
				return defer.resolve(value);
			};
			Q(runOne()).progress(defer.notify).fail(defer.reject);

			return defer.promise;
		}
	}

	export class PromiseHandle<T> {

		promise:Q.Promise<T>;
		defer:Q.Deferred<T>;

		constructor(defer?:Q.Deferred<T>, promise?:Q.Promise<T>) {
			this.defer = defer;
			this.promise = (defer ? defer.promise : promise);
		}

	}

	export class PromiseStash<T> {

		private _stash:xm.KeyValueMap<Q.Deferred<T>> = new xm.KeyValueMap();

		constructor() {
		}

		/*getHandle(key:string, fresh?:string):xm.PromiseHandle<T> {
		 if (fresh) {
		 this.remove(key);
		 }
		 else if (this.has(key)) {
		 return new xm.PromiseHandle<T>(null, this.promise(key));
		 }
		 return new xm.PromiseHandle<T>(this.defer(key));
		 }*/

		has(key:string):boolean {
			return this._stash.has(key);
		}

		promise(key:string):Q.Promise<T> {
			if (this._stash.has(key)) {
				return this._stash.get(key).promise;
			}
			return null;
		}

		defer(key:string):Q.Deferred<T> {
			if (this._stash.has(key)) {
				return null;
			}
			var d:Q.Deferred<T> = Q.defer<T>();
			this._stash.set(key, d);
			return d;
		}

		remove(key:string):void {
			return this._stash.remove(key);
		}
	}
}
