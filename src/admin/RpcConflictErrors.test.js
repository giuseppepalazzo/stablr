import {getCourseEditorError} from './course-editor-data';
import {getRouteEditorError} from './route-editor-data';

test.each([getCourseEditorError,getRouteEditorError])('legacy and non-retryable RPC conflicts retain the same blocked-publication message',format=>{
  expect(format({code:'PT409'})).toBe(format({code:'40001'}));
  expect(format({code:'PT409'})).toMatch(/cambiati.*pubblicazione è stata bloccata/);
});
