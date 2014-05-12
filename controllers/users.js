var async = require('async')
  , config = require('../config')
  , log = require('../log')
  , models = require('../models')
  , services = require('../services')
  , utils = require('../utils');

var authorize = function(req, res) {
    var key = req.param('api_key');
    var app_id = req.param('app_id');
    var redirect_uri = req.param('redirect_uri');
    var scope = req.param('scope');

    services.apiKeys.check(key, redirect_uri, function(err, apiKey) {
        if (err) return utils.handleError(res, err);

        if (!app_id) return redirectWithError(res, redirect_uri, "app_id required for authorize");
        if (!scope) return redirectWithError(res, redirect_uri, "scope required for authorize");

        services.principals.findById(services.principals.servicePrincipal, app_id, function(err, app) {
            if (err) return redirectWithError(res, redirect_uri, err);
            if (!app) return redirectWithError(res, redirect_uri, "app_id referenced unknown application.");

            var authCode = models.AuthCode({
                api_key: apiKey.id,
                app: app_id,
                name: apiKey.name,
                user: req.user.id,
                scope: scope,
                redirect_uri: redirect_uri
            });

            services.authCodes.create(authCode, function(err, authCode) {
                if (err) return redirectWithError(res, redirect_uri, err);

                populateClauses(req, authCode.scope, function(err, scope) {
                    if (err) return redirectWithError(res, redirect_uri, err);

                    res.render('user/authorize', {
                        apiKey:             apiKey,
                        code:               authCode.code,
                        scope:              scope,
                        user_decision_path: config.user_decision_path
                    });
                });
            });
        });
    });
};

var populateClauses = function(req, scope, callback) {
    if (typeof scope === 'string') {
        try {
            scope = JSON.parse(scope);
        } catch(e) {
            callback('scope did not parse as JSON.');
        }
    }

    async.concat(scope, function(clause, clauseCallback) {
        services.principals.find(req.user, clause.filter, {}, function(err, clausePrincipals) {
            if (err) return callback(err);

            clause.principals = clausePrincipals;
            return clauseCallback(null, [clause]);
        });
    }, callback);
};

var changePassword = function(req, res) {
    var currentPassword = req.param('currentPassword');
    var newPassword = req.param('newPassword');
    var newPasswordAgain = req.param('newPasswordAgain');

    if (!currentPassword || !newPassword || !newPasswordAgain) {
        return renderChangePasswordForm(res, 'Please fill out all three passwords before submitting.');
    }

    if (newPassword !== newPasswordAgain) {
        return renderChangePasswordForm(res, 'New password does not match confirmation, please try again.');
    }

    services.principals.authenticateUser(req.user.email, currentPassword, function(err, user) {
        if (err || !user) return renderChangePasswordForm(res, 'Please re-enter your current password and try again.');

        services.principals.changePassword(req.user, newPassword, function(err, principal, accessToken) {
            if (err) return utils.handleError(res, err);

            return renderLoginForm(res, 'Your password was changed: please login with your new password.');
        });
    });
};

var renderChangePasswordForm = function(res, error) {
    res.render('user/changePassword', {
        error: error,
        user_change_password_path: config.user_change_password_path
    });
};

var changePasswordForm = function(req, res) {
    return renderChangePasswordForm(res);
};

var create = function(req, res) {
    var name = req.param('name');
    var email = req.param('email');
    var password = req.param('password');

    if (!name || !email || !password) {
        return renderCreateForm(res, "Please enter your full name, an email, and a password.");
    }

    var user = new models.Principal({
        type: 'user',
        name: name,
        email: email,
        password: password
    });

    services.principals.create(user, function(err, user) {
        if (err) return renderCreateForm(res, err);

        return logInAndRedirect(req, res, user);
    });
};

var renderCreateForm = function(res, error) {
    res.render('user/create', {
        error: error,
        user_create_path: config.user_create_path,
        user_reset_password_path: config.user_reset_password_path,
        user_login_path: config.user_login_path
    });
};

var createForm = function(req, res) {
    return renderCreateForm(res);
};

var decision = function(req, res) {
    var code = req.param('code');
    var authorized = (req.param('authorize') !== undefined && req.param('authorize'));

    services.authCodes.check(code, req.user, function(err, authCode) {
        if (err) return utils.handleError(res, err);
        if (!authorized) return redirectWithError(res, authCode.redirect_uri, "Authorization request not approved by user.");

        services.principals.findById(services.principals.servicePrincipal, authCode.app, function(err, app) {
            if (err) return redirectWithError(res, authCode.redirect_uri, err);
            if (!app) return redirectWithError(res, authCode.redirect_uri, "Application not found");

            populateClauses(req, authCode.scope, function(err, scope) {
                if (err) return redirectWithError(res, authCode.redirect_uri, err);

                async.each(scope, function(clause, clauseCallback) {
                    async.each(clause.actions, function(action, actionCallback) {
                        async.each(clause.principals, function(principal, principalCallback) {

                            var permission = new models.Permission({
                                action: action,
                                authorized: true,
                                issued_to: app.id,
                                principal_for: principal.id,
                                priority: models.Permission.DEFAULT_PRIORITY_BASE
                            });

                            services.permissions.create(req.user, permission, principalCallback);

                        }, actionCallback);
                    }, clauseCallback);
                }, function(err) {
                    redirectWithError(res, authCode.redirect_uri, err);
                });
            });
        });
    });
};

var impersonate = function(req, res) {
    var key = req.param('api_key');
    var redirect_uri = req.param('redirect_uri');

    services.apiKeys.check(key, redirect_uri, function(err, apiKey) {
        if (err) return utils.handleError(res, err);
        if (!apiKey.can('impersonate')) return redirectWithError(res, redirect_uri, "Impersonation of user not allowed.");

        return redirectWithSession(res, req.user, redirect_uri);
    });
};

var renderLoginForm = function(res, error) {
    res.render('user/login', {
        error: error,
        user_create_path: config.user_create_path,
        user_reset_password_path: config.user_reset_password_path,
        user_login_path: config.user_login_path
    });
};

var login = function(req, res) {
    var email = req.param('email');
    var password = req.param('password');

    if (!email || !password) {
        return renderLoginForm(res, "Please enter your email and password to login.");
    }

    services.principals.authenticateUser(email, password, function (err, user) {
        if (err || !user) return renderLoginForm(res, 'Either your email or password were not correct. Please try again.');

        return logInAndRedirect(req, res, user);
    });
};

var logInAndRedirect = function(req, res, user) {
    req.logIn(user, function(err) {
        if (err) return renderLoginForm(res, err);

        return res.redirect(req.session.returnTo || config.default_user_redirect);
    });
};

var loginForm = function(req, res) {
    return renderLoginForm(res);
};

var redirectWithError = function(res, redirectUri, error) {
    var finalRedirectUri = redirectUri;
    if (error)
        finalRedirectUri += "?error=" + encodeURIComponent(error);

    res.redirect(finalRedirectUri);
};

var redirectWithSession = function(res, user, redirectUri) {
    services.accessTokens.findOrCreateToken(user, function (err, accessToken) {
        if (err) return redirectWithError(res, redirectUri, err);

        res.redirect(redirectUri + "?principal=" + encodeURIComponent(JSON.stringify(user.toObject())) +
            "&accessToken=" + encodeURIComponent(JSON.stringify(accessToken.toObject())));
    });
};

var resetPassword = function(req, res) {
    var email = req.param('email');

    if (!email) return renderResetPasswordForm(res, "Please enter an email to reset your password.");

    services.principals.find(services.principals.servicePrincipal, { email: email }, function(err, principals) {
        if (err) return renderResetPasswordForm(res, err);
        if (principals.length < 1) return renderResetPasswordForm(res, 'User with email "' + email + '" not found.');

        services.principals.resetPassword(services.principals.servicePrincipal, principals[0], function(err) {
            if (err) return utils.handleError(res, err);

            return renderLoginForm(res, 'Your password was reset: please check your email for instructions.');
        });
    });
};

var renderResetPasswordForm = function(res, error) {
    res.render('user/resetPassword', {
        error: error,
        user_create_path: config.user_create_path,
        user_reset_password_path: config.user_reset_password_path,
        user_login_path: config.user_login_path
    });
};

var resetPasswordForm = function(req, res) {
    renderResetPasswordForm(res);
};

module.exports = {
    authorize:              authorize,
    changePassword:         changePassword,
    changePasswordForm:     changePasswordForm,
    create:                 create,
    createForm:             createForm,
    decision:               decision,
    impersonate:            impersonate,
    login:                  login,
    loginForm:              loginForm,
    resetPassword:          resetPassword,
    resetPasswordForm:      resetPasswordForm
};