import {
	types,
	ensureTypedArg,
	ensureInstanceOf
}
from './utils';
import {
	valueOverLifetimeLength
}
from '../constants';
import ShaderAttribute from '../helpers/ShaderAttribute';
import shaders from '../shaders/shaders';
import Emitter from './Emitter';

import {
	Math as THREEMath
}
from 'three';
import {
	Texture as THREETexture
}
from 'three';
import {
	Vector2 as THREEVector2
}
from 'three';
import {
	Vector3 as THREEVector3
}
from 'three';
import {
	Vector4 as THREEVector4
}
from 'three';
import {
	AdditiveBlending as THREEAdditiveBlending
}
from 'three';
import {
	ShaderMaterial as THREEShaderMaterial
}
from 'three';
import {
	BufferGeometry as THREEBufferGeometry
}
from 'three';
import {
	Points as THREEPoints
}
from 'three';

/**
 * An SPE.Group instance.
 * @typedef {Object} Group
 * @see SPE.Group
 */

/**
 * A map of options to configure an SPE.Group instance.
 * @typedef {Object} GroupOptions
 *
 * @property {Object} texture An object describing the texture used by the group.
 *
 * @property {Object} texture.value An instance of THREE.Texture.
 *
 * @property {Object=} texture.frames A THREE.Vector2 instance describing the number
 *                                    of frames on the x- and y-axis of the given texture.
 *                                    If not provided, the texture will NOT be treated as
 *                                    a sprite-sheet and as such will NOT be animated.
 *
 * @property {Number} [texture.frameCount=texture.frames.x * texture.frames.y] The total number of frames in the sprite-sheet.
 *                                                                   Allows for sprite-sheets that don't fill the entire
 *                                                                   texture.
 *
 * @property {Number} texture.loop The number of loops through the sprite-sheet that should
 *                                 be performed over the course of a single particle's lifetime.
 *
 * @property {Number} fixedTimeStep If no `dt` (or `deltaTime`) value is passed to this group's
 *                                  `tick()` function, this number will be used to move the particle
 *                                  simulation forward. Value in SECONDS.
 *
 * @property {Boolean} hasPerspective Whether the distance a particle is from the camera should affect
 *                                    the particle's size.
 *
 * @property {Boolean} colorize Whether the particles in this group should be rendered with color, or
 *                              whether the only color of particles will come from the provided texture.
 *
 * @property {Number} blending One of Three.js's blending modes to apply to this group's `ShaderMaterial`.
 *
 * @property {Boolean} transparent Whether these particle's should be rendered with transparency.
 *
 * @property {Number} alphaTest Sets the alpha value to be used when running an alpha test on the `texture.value` property. Value between 0 and 1.
 *
 * @property {Boolean} depthWrite Whether rendering the group has any effect on the depth buffer.
 *
 * @property {Boolean} depthTest Whether to have depth test enabled when rendering this group.
 *
 * @property {Boolean} fog Whether this group's particles should be affected by their scene's fog.
 *
 * @property {Number} scale The scale factor to apply to this group's particle sizes. Useful for
 *                          setting particle sizes to be relative to renderer size.
 */

/**
 * The SPE.Group class. Creates a new group, containing a material, geometry, and mesh.
 *
 * @constructor
 * @param {GroupOptions} options A map of options to configure the group instance.
 */
export default class Group {
	constructor( options = {} ) {
		// Ensure we have a map of options to play with
		options.texture = ensureTypedArg( options.texture, types.OBJECT, {} );

		// Assign a UUID to this instance
		this.uuid = THREEMath.generateUUID();

		// If no `deltaTime` value is passed to the `SPE.Group.tick` function,
		// the value of this property will be used to advance the simulation.
		this.fixedTimeStep = ensureTypedArg( options.fixedTimeStep, types.NUMBER, 0.016 );

		// Set properties used in the uniforms map, starting with the
		// texture stuff.
		this.texture = ensureInstanceOf( options.texture.value, THREETexture, null );
		this.textureFrames = ensureInstanceOf( options.texture.frames, THREEVector2, new THREEVector2( 1, 1 ) );
		this.textureFrameCount = ensureTypedArg( options.texture.frameCount, types.NUMBER, this.textureFrames.x * this.textureFrames.y );
		this.textureLoop = ensureTypedArg( options.texture.loop, types.NUMBER, 1 );
		this.textureFrames.max( new THREEVector2( 1, 1 ) );

		this.hasPerspective = ensureTypedArg( options.hasPerspective, types.BOOLEAN, true );
		this.colorize = ensureTypedArg( options.colorize, types.BOOLEAN, true );

		this.maxParticleCount = ensureTypedArg( options.maxParticleCount, types.NUMBER, null );

		// Set properties used to define the ShaderMaterial's appearance.
		this.blending = ensureTypedArg( options.blending, types.NUMBER, THREEAdditiveBlending );
		this.transparent = ensureTypedArg( options.transparent, types.BOOLEAN, true );
		this.alphaTest = parseFloat( ensureTypedArg( options.alphaTest, types.NUMBER, 0.0 ) );
		this.depthWrite = ensureTypedArg( options.depthWrite, types.BOOLEAN, false );
		this.depthTest = ensureTypedArg( options.depthTest, types.BOOLEAN, true );
		this.fog = ensureTypedArg( options.fog, types.BOOLEAN, true );
		this.scale = ensureTypedArg( options.scale, types.NUMBER, 300 );

		// Where emitter's go to curl up in a warm blanket and live
		// out their days.
		this.emitters = [];
		this.emitterIDs = [];

		// Create properties for use by the emitter pooling functions.
		this._pool = [];
		this._poolCreationSettings = null;
		this._createNewWhenPoolEmpty = 0;

		// Whether all attributes should be forced to updated
		// their entire buffer contents on the next tick.
		//
		// Used when an emitter is removed.
		this._attributesNeedRefresh = false;
		this._attributesNeedDynamicReset = false;

		this.particleCount = 0;

		// Map of uniforms to be applied to the ShaderMaterial instance.
		this.uniforms = {
			texture: {
				type: 't',
				value: this.texture
			},
			textureAnimation: {
				type: 'v4',
				value: new THREEVector4(
					this.textureFrames.x,
					this.textureFrames.y,
					this.textureFrameCount,
					Math.max( Math.abs( this.textureLoop ), 1.0 )
				)
			},
			fogColor: {
				type: 'c',
				value: null
			},
			fogNear: {
				type: 'f',
				value: 10
			},
			fogFar: {
				type: 'f',
				value: 200
			},
			fogDensity: {
				type: 'f',
				value: 0.5
			},
			deltaTime: {
				type: 'f',
				value: 0
			},
			runTime: {
				type: 'f',
				value: 0
			},
			scale: {
				type: 'f',
				value: this.scale
			}
		};

		// Add some defines into the mix...
		this.defines = {
			HAS_PERSPECTIVE: this.hasPerspective,
			COLORIZE: this.colorize,
			VALUE_OVER_LIFETIME_LENGTH: valueOverLifetimeLength,

			SHOULD_ROTATE_TEXTURE: false,
			SHOULD_ROTATE_PARTICLES: false,
			SHOULD_WIGGLE_PARTICLES: false,

			SHOULD_CALCULATE_SPRITE: this.textureFrames.x > 1 || this.textureFrames.y > 1,
			USE_TEXTURE: !!this.texture
		};

		// Map of all attributes to be applied to the particles.
		//
		// See ShaderAttribute for a bit more info on this bit.
		this.attributes = {
			position: new ShaderAttribute( 'v3', true ),
			acceleration: new ShaderAttribute( 'v4', true ), // w component is drag
			velocity: new ShaderAttribute( 'v3', true ),
			rotation: new ShaderAttribute( 'v4', true ),
			rotationCenter: new ShaderAttribute( 'v3', true ),
			params: new ShaderAttribute( 'v4', true ), // Holds (alive, age, delay, wiggle)
			size: new ShaderAttribute( 'v4', true ),
			angle: new ShaderAttribute( 'v4', true ),
			color: new ShaderAttribute( 'v4', true ),
			opacity: new ShaderAttribute( 'v4', true )
		};

		this.attributeKeys = Object.keys( this.attributes );
		this.attributeCount = this.attributeKeys.length;

		// Create the ShaderMaterial instance that'll help render the
		// particles.
		this.material = new THREEShaderMaterial( {
			uniforms: this.uniforms,
			vertexShader: shaders.vertex,
			fragmentShader: shaders.fragment,
			blending: this.blending,
			transparent: this.transparent,
			alphaTest: this.alphaTest,
			depthWrite: this.depthWrite,
			depthTest: this.depthTest,
			defines: this.defines,
			fog: this.fog
		} );

		// Create the BufferGeometry and Points instances, ensuring
		// the geometry and material are given to the latter.
		this.geometry = new THREEBufferGeometry();
		this.mesh = new THREEPoints( this.geometry, this.material );

		if ( this.maxParticleCount === null ) {
			console.warn( 'SPE.Group: No maxParticleCount specified. Adding emitters after rendering will probably cause errors.' );
		}
	}

	_updateDefines() {
		const emitters = this.emitters,
			defines = this.defines;

		for ( let i = emitters.length - 1; i >= 0; --i ) {
			const emitter = emitters[ i ];

			// Only do angle calculation if there's no spritesheet defined.
			//
			// Saves calculations being done and then overwritten in the shaders.
			if ( !defines.SHOULD_CALCULATE_SPRITE ) {
				defines.SHOULD_ROTATE_TEXTURE = defines.SHOULD_ROTATE_TEXTURE || !!Math.max(
					Math.max.apply( null, emitter.angle.value ),
					Math.max.apply( null, emitter.angle.spread )
				);
			}

			defines.SHOULD_ROTATE_PARTICLES = defines.SHOULD_ROTATE_PARTICLES || !!Math.max(
				emitter.rotation.angle,
				emitter.rotation.angleSpread
			);

			defines.SHOULD_WIGGLE_PARTICLES = defines.SHOULD_WIGGLE_PARTICLES || !!Math.max(
				emitter.wiggle.value,
				emitter.wiggle.spread
			);
		}

		this.material.needsUpdate = true;
	}

	_applyAttributesToGeometry() {
		const attributes = this.attributes,
			geometry = this.geometry,
			geometryAttributes = geometry.attributes;

		// Loop through all the shader attributes and assign (or re-assign)
		// typed array buffers to each one.
		for ( const attr in attributes ) {
			if ( attributes.hasOwnProperty( attr ) ) {
				const attribute = attributes[ attr ];
				const geometryAttribute = geometryAttributes[ attr ];

				// Update the array if this attribute exists on the geometry.
				//
				// This needs to be done because the attribute's typed array might have
				// been resized and reinstantiated, and might now be looking at a
				// different ArrayBuffer, so reference needs updating.
				if ( geometryAttribute ) {
					geometryAttribute.array = attribute.typedArray.array;
				}

				// // Add the attribute to the geometry if it doesn't already exist.
				else {
					geometry.addAttribute( attr, attribute.bufferAttribute );
				}

				// Mark the attribute as needing an update the next time a frame is rendered.
				attribute.bufferAttribute.needsUpdate = true;
			}
		}

		// Mark the draw range on the geometry. This will ensure
		// only the values in the attribute buffers that are
		// associated with a particle will be used in THREE's
		// render cycle.
		this.geometry.setDrawRange( 0, this.particleCount );
	}

	/**
	 * Adds an SPE.Emitter instance to this group, creating particle values and
	 * assigning them to this group's shader attributes.
	 *
	 * @param {Emitter} emitter The emitter to add to this group.
	 */
	addEmitter( emitter ) {
		// Ensure an actual emitter instance is passed here.
		//
		// Decided not to throw here, just in case a scene's
		// rendering would be paused. Logging an error instead
		// of stopping execution if exceptions aren't caught.
		if ( emitter instanceof Emitter === false ) {
			console.error( '`emitter` argument must be instance of SPE.Emitter. Was provided with:', emitter );
			return;
		}

		// If the emitter already exists as a member of this group, then
		// stop here, we don't want to add it again.
		else if ( this.emitterIDs.indexOf( emitter.uuid ) > -1 ) {
			console.error( 'Emitter already exists in this group. Will not add again.' );
			return;
		}

		// And finally, if the emitter is a member of another group,
		// don't add it to this group.
		else if ( emitter.group !== null ) {
			console.error( 'Emitter already belongs to another group. Will not add to requested group.' );
			return;
		}

		var attributes = this.attributes,
			start = this.particleCount,
			end = start + emitter.particleCount;

		// Update this group's particle count.
		this.particleCount = end;

		// Emit a warning if the emitter being added will exceed the buffer sizes specified.
		if ( this.maxParticleCount !== null && this.particleCount > this.maxParticleCount ) {
			console.warn( 'SPE.Group: maxParticleCount exceeded. Requesting', this.particleCount, 'particles, can support only', this.maxParticleCount );
		}


		// Set the `particlesPerSecond` value (PPS) on the emitter.
		// It's used to determine how many particles to release
		// on a per-frame basis.
		emitter._calculatePPSValue( emitter.maxAge._value + emitter.maxAge._spread );
		emitter._setBufferUpdateRanges( this.attributeKeys );

		// Store the offset value in the TypedArray attributes for this emitter.
		emitter._setAttributeOffset( start );

		// Save a reference to this group on the emitter so it knows
		// where it belongs.
		emitter.group = this;

		// Store reference to the attributes on the emitter for
		// easier access during the emitter's tick function.
		emitter.attributes = this.attributes;



		// Ensure the attributes and their BufferAttributes exist, and their
		// TypedArrays are of the correct size.
		for ( var attr in attributes ) {
			if ( attributes.hasOwnProperty( attr ) ) {
				// When creating a buffer, pass through the maxParticle count
				// if one is specified.
				attributes[ attr ]._createBufferAttribute(
					this.maxParticleCount !== null ?
					this.maxParticleCount :
					this.particleCount
				);
			}
		}

		// Loop through each particle this emitter wants to have, and create the attributes values,
		// storing them in the TypedArrays that each attribute holds.
		for ( var i = start; i < end; ++i ) {
			emitter._assignPositionValue( i );
			emitter._assignForceValue( i, 'velocity' );
			emitter._assignForceValue( i, 'acceleration' );
			emitter._assignAbsLifetimeValue( i, 'opacity' );
			emitter._assignAbsLifetimeValue( i, 'size' );
			emitter._assignAngleValue( i );
			emitter._assignRotationValue( i );
			emitter._assignParamsValue( i );
			emitter._assignColorValue( i );
		}

		// Update the geometry and make sure the attributes are referencing
		// the typed arrays properly.
		this._applyAttributesToGeometry();

		// Store this emitter in this group's emitter's store.
		this.emitters.push( emitter );
		this.emitterIDs.push( emitter.uuid );

		// Update certain flags to enable shader calculations only if they're necessary.
		this._updateDefines( emitter );

		// Update the material since defines might have changed
		this.material.needsUpdate = true;
		this.geometry.needsUpdate = true;
		this._attributesNeedRefresh = true;

		// Return the group to enable chaining.
		return this;
	}

	/**
	 * Removes an SPE.Emitter instance from this group. When called,
	 * all particle's belonging to the given emitter will be instantly
	 * removed from the scene.
	 *
	 * @param {Emitter} emitter The emitter to add to this group.
	 */
	removeEmitter( emitter ) {
		var emitterIndex = this.emitterIDs.indexOf( emitter.uuid );

		// Ensure an actual emitter instance is passed here.
		//
		// Decided not to throw here, just in case a scene's
		// rendering would be paused. Logging an error instead
		// of stopping execution if exceptions aren't caught.
		if ( emitter instanceof Emitter === false ) {
			console.error( '`emitter` argument must be instance of SPE.Emitter. Was provided with:', emitter );
			return;
		}

		// Issue an error if the emitter isn't a member of this group.
		else if ( emitterIndex === -1 ) {
			console.error( 'Emitter does not exist in this group. Will not remove.' );
			return;
		}

		// Kill all particles by marking them as dead
		// and their age as 0.
		var start = emitter.attributeOffset,
			end = start + emitter.particleCount,
			params = this.attributes.params.typedArray;

		// Set alive and age to zero.
		for ( var i = start; i < end; ++i ) {
			params.array[ i * 4 ] = 0.0;
			params.array[ i * 4 + 1 ] = 0.0;
		}

		// Remove the emitter from this group's "store".
		this.emitters.splice( emitterIndex, 1 );
		this.emitterIDs.splice( emitterIndex, 1 );

		// Remove this emitter's attribute values from all shader attributes.
		// The `.splice()` call here also marks each attribute's buffer
		// as needing to update it's entire contents.
		for ( var attr in this.attributes ) {
			if ( this.attributes.hasOwnProperty( attr ) ) {
				this.attributes[ attr ].splice( start, end );
			}
		}

		// Ensure this group's particle count is correct.
		this.particleCount -= emitter.particleCount;

		// Call the emitter's remove method.
		emitter._onRemove();

		// Set a flag to indicate that the attribute buffers should
		// be updated in their entirety on the next frame.
		this._attributesNeedRefresh = true;
	}


	/**
	 * Fetch a single emitter instance from the pool.
	 * If there are no objects in the pool, a new emitter will be
	 * created if specified.
	 *
	 * @return {Emitter|null}
	 */
	getFromPool() {
		var pool = this._pool,
			createNew = this._createNewWhenPoolEmpty;

		if ( pool.length ) {
			return pool.pop();
		}
		else if ( createNew ) {
			this.addEmitter( new Emitter( this._poolCreationSettings ) );
		}

		return null;
	}


	/**
	 * Release an emitter into the pool.
	 *
	 * @param  {ShaderParticleEmitter} emitter
	 * @return {Group} This group instance.
	 */
	releaseIntoPool( emitter ) {
		if ( emitter instanceof Emitter === false ) {
			console.error( 'Argument is not instanceof SPE.Emitter:', emitter );
			return;
		}

		emitter.reset();
		this._pool.unshift( emitter );

		return this;
	}


	/**
	 * Get the pool array
	 *
	 * @return {Array}
	 */
	getPool() {
		return this._pool;
	}


	/**
	 * Add a pool of emitters to this particle group
	 *
	 * @param {Number} numEmitters      The number of emitters to add to the pool.
	 * @param {EmitterOptions|Array} emitterOptions  An object, or array of objects, describing the options to pass to each emitter.
	 * @param {Boolean} createNew       Should a new emitter be created if the pool runs out?
	 * @return {Group} This group instance.
	 */
	addPool( numEmitters, emitterOptions, createNew ) {
		var emitter;

		// Save relevant settings and flags.
		this._poolCreationSettings = emitterOptions;
		this._createNewWhenPoolEmpty = !!createNew;

		// Create the emitters, add them to this group and the pool.
		for ( var i = 0; i < numEmitters; ++i ) {
			if ( Array.isArray( emitterOptions ) ) {
				emitter = new Emitter( emitterOptions[ i ] );
			}
			else {
				emitter = new Emitter( emitterOptions );
			}
			this.addEmitter( emitter );
			this.releaseIntoPool( emitter );
		}

		return this;
	}



	_triggerSingleEmitter( pos ) {
		var emitter = this.getFromPool(),
			self = this;

		if ( emitter === null ) {
			console.log( 'SPE.Group pool ran out.' );
			return;
		}

		// TODO:
		// - Make sure buffers are update with this new position.
		if ( pos instanceof THREEVector3 ) {
			emitter.position.value.copy( pos );

			// Trigger the setter for this property to force an
			// update to the emitter's position attribute.
			emitter.position.value = emitter.position.value;
		}

		emitter.enable();

		setTimeout( function() {
			emitter.disable();
			self.releaseIntoPool( emitter );
		}, ( Math.max( emitter.duration, ( emitter.maxAge.value + emitter.maxAge.spread ) ) ) * 1000 );

		return this;
	}


	/**
	 * Set a given number of emitters as alive, with an optional position
	 * vector3 to move them to.
	 *
	 * @param  {Number} numEmitters The number of emitters to activate
	 * @param  {Object} [position=undefined] A THREE.Vector3 instance describing the position to activate the emitter(s) at.
	 * @return {Group} This group instance.
	 */
	triggerPoolEmitter( numEmitters, position ) {
		if ( typeof numEmitters === 'number' && numEmitters > 1 ) {
			for ( var i = 0; i < numEmitters; ++i ) {
				this._triggerSingleEmitter( position );
			}
		}
		else {
			this._triggerSingleEmitter( position );
		}

		return this;
	}



	_updateUniforms( dt ) {
		this.uniforms.runTime.value += dt;
		this.uniforms.deltaTime.value = dt;
	}

	_resetBufferRanges() {
		var keys = this.attributeKeys,
			i = this.attributeCount - 1,
			attrs = this.attributes;

		for ( i; i >= 0; --i ) {
			attrs[ keys[ i ] ].resetUpdateRange();
		}
	}


	_updateBuffers( emitter ) {
		var keys = this.attributeKeys,
			i = this.attributeCount - 1,
			attrs = this.attributes,
			emitterRanges = emitter.bufferUpdateRanges,
			key,
			emitterAttr,
			attr;

		for ( i; i >= 0; --i ) {
			key = keys[ i ];
			emitterAttr = emitterRanges[ key ];
			attr = attrs[ key ];
			attr.setUpdateRange( emitterAttr.min, emitterAttr.max );
			attr.flagUpdate();
		}
	}


	/**
	 * Simulate all the emitter's belonging to this group, updating
	 * attribute values along the way.
	 * @param  {Number} [dt=Group's `fixedTimeStep` value] The number of seconds to simulate the group's emitters for (deltaTime)
	 */
	tick( dt ) {
		var emitters = this.emitters,
			numEmitters = emitters.length,
			deltaTime = dt || this.fixedTimeStep,
			keys = this.attributeKeys,
			i,
			attrs = this.attributes;

		// Update uniform values.
		this._updateUniforms( deltaTime );

		// Reset buffer update ranges on the shader attributes.
		this._resetBufferRanges();


		// If nothing needs updating, then stop here.
		if (
			numEmitters === 0 &&
			this._attributesNeedRefresh === false &&
			this._attributesNeedDynamicReset === false
		) {
			return;
		}

		// Loop through each emitter in this group and
		// simulate it, then update the shader attribute
		// buffers.
		for ( var i = 0, emitter; i < numEmitters; ++i ) {
			emitter = emitters[ i ];
			emitter.tick( deltaTime );
			this._updateBuffers( emitter );
		}

		// If the shader attributes have been refreshed,
		// then the dynamic properties of each buffer
		// attribute will need to be reset back to
		// what they should be.
		if ( this._attributesNeedDynamicReset === true ) {
			i = this.attributeCount - 1;

			for ( i; i >= 0; --i ) {
				attrs[ keys[ i ] ].resetDynamic();
			}

			this._attributesNeedDynamicReset = false;
		}

		// If this group's shader attributes need a full refresh
		// then mark each attribute's buffer attribute as
		// needing so.
		if ( this._attributesNeedRefresh === true ) {
			i = this.attributeCount - 1;

			for ( i; i >= 0; --i ) {
				attrs[ keys[ i ] ].forceUpdateAll();
			}

			this._attributesNeedRefresh = false;
			this._attributesNeedDynamicReset = true;
		}
	}


	/**
	 * Dipose the geometry and material for the group.
	 *
	 * @return {Group} Group instance.
	 */
	dispose() {
		this.geometry.dispose();
		this.material.dispose();
		return this;
	}

	update() {
		this.texture = ensureInstanceOf( this.texture, THREETexture, null );
		this.textureFrames = ensureInstanceOf( this.textureFrames, THREEVector2, new THREEVector2( 1, 1 ) );
		this.textureFrameCount = ensureTypedArg( this.textureFrameCount, types.NUMBER, this.textureFrames.x * this.textureFrames.y );
		this.textureLoop = ensureTypedArg( this.textureLoop, types.NUMBER, 1 );

		this.defines.USE_TEXTURE = !!this.texture;

		this.uniforms.texture.value = this.texture;
		this.uniforms.scale.value = this.scale;
		this.uniforms.textureAnimation.value.set(
			this.textureFrames.x,
			this.textureFrames.y,
			this.textureFrameCount,
			Math.max( Math.abs( this.textureLoop ), 1.0 )
		);

		this.material.needsUpdate = true;
	}

	updateAll() {
		var emitters = this.emitters,
			numEmitters = emitters.length;

		this.update();

		// If nothing needs updating, then stop here.
		if ( numEmitters === 0 ) {
			return;
		}

		for ( var i = 0, emitter; i < numEmitters; ++i ) {
			emitters[ i ].update();
		}
	}
};
