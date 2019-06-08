import { createReducer } from '../utils';
import { promiseStates } from '../constants';
import { Cmd, loop } from 'redux-loop';
import { createSelector } from 'reselect';

const REQUESTED = 'REQUESTED';
const RECEIVED = 'RECEIVED';
const FAILED = 'FAILED';
const UPDATE = 'UPDATE';
const DELETE = 'DELETE';
const RESET = 'RESET';

const defaultOptions = {
  sequence: false
};

const defaultActions = {
  actions: [],
  options: defaultOptions
};

const requestedDefault = Object.create(defaultActions);
const receivedDefault = Object.create(defaultActions);
const failedDefault = Object.create(defaultActions);

export default (config) => {
  const logger = config.debug ? console.log : () => {};

  const actionGenerator = (actions, rootAction, ...rest) => {
    logger(`${config.actionPrefix}:actionGenerator > `, actions, rootAction, rest);
    return actions
        .map(action => Cmd.action(action(rootAction)));
  };

  const extractHttpStatus = payload => ({
    headers: payload.headers,
    statusText: payload.statusText,
    status: payload.status
  });

  const reducerCreator = ({
                            actionPrefix,
                            requestHandler,
                            requested = requestedDefault,
                            received = receivedDefault,
                            rejected = failedDefault,
                            receivedDataTransformer = receivedData => ({ data: receivedData }),
                            initialState = {
                              data: {},
                              promiseState: promiseStates.INIT,
                            }
                          }) => {
    const requestActionHandler = (state, rootAction) => {
      logger(`${rootAction.type}:`, state, rootAction);
      const { url, params, data } = rootAction;
      return loop(
          {
            ...state,
            promiseState: promiseStates.PENDING,
          },
          Cmd.list([
            Cmd.run(requestHandler, {
              successActionCreator: successResponse => ({
                type: `${actionPrefix}_${RECEIVED}`,
                successResponse,
                rootAction
              }),
              failActionCreator: errorResponse => ({
                type: `${actionPrefix}_${FAILED}`,
                errorResponse,
                rootAction
              }),
              args: [url, params, data]
            }),
            ...actionGenerator(requested.actions, rootAction)
          ], {
            ...requested.options
          }),
      );
    };

    const receivedActionHandler = (state, action) => {
      logger(`${action.type}:`, state, action);
      const transformedData = receivedDataTransformer(action.successResponse.data);
      const requestData = extractHttpStatus(action.successResponse);
      return loop({
        ...state,
        ...transformedData,
        ...requestData,
        promiseState: promiseStates.RESOLVED,
      }, Cmd.list([
        ...actionGenerator(received.actions, action)
      ], {
        ...received.options
      }));
    };

    const failedActionHandler = (state, action) => {
      logger(`${action.type}:`, state, action);
      const requestData = extractHttpStatus(action.errorResponse.response);
      return loop({
        ...state,
        ...requestData,
        ...initialState,
        promiseState: promiseStates.REJECTED,
      }, Cmd.list([
        ...actionGenerator(rejected.actions, action)
      ], {
        ...rejected.options
      }));
    };

    const resetActionHandler = (state) => {
      logger(`${config.actionPrefix}_${RESET}`, state);
      return ({
        ...state,
        ...initialState,
      });
    };

    const handlers = {
      [`${actionPrefix}_${REQUESTED}`]: requestActionHandler,
      [`${actionPrefix}_${RECEIVED}`]: receivedActionHandler,
      [`${actionPrefix}_${FAILED}`]: failedActionHandler,
      [`${actionPrefix}_${RESET}`]: resetActionHandler,
    };

    if (config.updateActionHandler) {
      handlers[`${actionPrefix}_${UPDATE}`] = config.updateActionHandler;
    }

    if (config.deleteActionHandler) {
      handlers[`${actionPrefix}_${DELETE}`] = config.deleteActionHandler;
    }

    return createReducer(
        initialState,
        handlers
    );
  };

  const publicInterface = {
    request: (url, params = {}, data = {}, extraPayload = {}) => ({
      type: `${config.actionPrefix}_${REQUESTED}`,
      url,
      params,
      data,
      extraPayload
    }),
    reset: () => ({
      type: `${config.actionPrefix}_${RESET}`,
    }),
    reducer: reducerCreator(config),
    storeName: config.storeName,
    selector: config.selector || createSelector(
        (state) => {
          logger(`${config.actionPrefix}:selector`, state);
          return state[config.storeName];
        },
        (componentState) => {
          logger(`${config.actionPrefix}:selector`, componentState);
          return ({
            ...componentState,
          });
        }
    ),
  };

  if (config.updateActionHandler) {
    publicInterface.update = payload => ({
      type: `${config.actionPrefix}_${UPDATE}`,
      payload
    });
  }

  if (config.deleteActionHandler) {
    publicInterface.delete = (payload) => {
      logger(`${config.actionPrefix}:deleteActionHandler: `, payload);
      return ({
        type: `${config.actionPrefix}_${DELETE}`,
        payload
      });
    };
  }

  return (publicInterface);
};

