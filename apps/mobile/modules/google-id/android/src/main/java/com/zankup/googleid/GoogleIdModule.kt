package com.zankup.googleid

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * "Sign in with Google" through Android's Credential Manager (OS-503): an ID token for the instance's
 * web client that carries the server's nonce, so every sign-in gets a fresh token the API can check.
 * Resolves null when the sheet is dismissed.
 */
class GoogleIdModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleId")

    AsyncFunction("signIn") { webClientId: String, nonce: String, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("ERR_NO_ACTIVITY", "No activity to show the sheet on", null)
        return@AsyncFunction
      }
      val option = GetSignInWithGoogleOption.Builder(webClientId).setNonce(nonce).build()
      val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
      CoroutineScope(Dispatchers.Main).launch {
        try {
          val credential = CredentialManager.create(activity).getCredential(activity, request).credential
          if (credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
          ) {
            promise.resolve(GoogleIdTokenCredential.createFrom(credential.data).idToken)
          } else {
            promise.reject("ERR_UNEXPECTED", "Unexpected credential type", null)
          }
        } catch (error: GetCredentialCancellationException) {
          promise.resolve(null)
        } catch (error: GetCredentialException) {
          promise.reject("ERR_GOOGLE", "${error.type}: ${error.message}", error)
        } catch (error: Exception) {
          promise.reject("ERR_GOOGLE", error.message ?: "Google sign-in failed", error)
        }
      }
    }
  }
}
