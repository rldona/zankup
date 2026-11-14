package com.zankup.hapticclick

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A short, crisp click like the system's slider ticks (expo-haptics' Segment_Tick), but as strong as
 * asked: Android's CLICK primitive at a scale from 0 to 1. Phones without primitives get the predefined
 * click (heavy above 0.7), and older ones a 12 ms pulse.
 */
class HapticClickModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HapticClick")

    Function("click") { strength: Double ->
      val context = appContext.reactContext ?: return@Function
      val vibrator = vibrator(context) ?: return@Function
      if (!vibrator.hasVibrator()) return@Function
      val scale = strength.coerceIn(0.0, 1.0).toFloat()
      val effect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
          vibrator.areAllPrimitivesSupported(VibrationEffect.Composition.PRIMITIVE_CLICK)
        ) {
          VibrationEffect.startComposition()
            .addPrimitive(VibrationEffect.Composition.PRIMITIVE_CLICK, scale)
            .compose()
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          VibrationEffect.createPredefined(
            if (scale > 0.7f) VibrationEffect.EFFECT_HEAVY_CLICK else VibrationEffect.EFFECT_CLICK,
          )
        } else {
          VibrationEffect.createOneShot(12, (255 * scale).toInt().coerceIn(1, 255))
        }
      vibrator.vibrate(effect)
    }
  }

  private fun vibrator(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
}
