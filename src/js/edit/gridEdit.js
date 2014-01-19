(function () {
  'use strict';
  var module = angular.module('ui.grid.edit', ['ui.grid', 'ui.grid.util']);

  /**
   *  @ngdoc object
   *  @name ui.grid.edit.constant:uiGridEditConstants
   *
   *  @description constants available in edit module
   */
  module.constant('uiGridEditConstants', {
    EDITABLE_CELL_TEMPLATE: /EDITABLE_CELL_TEMPLATE/g,
    //must be lowercase because template bulder converts to lower
    EDITABLE_CELL_DIRECTIVE: /editable_cell_directive/g,
    events: {
      BEGIN_CELL_EDIT: 'uiGridEventBeginCellEdit',
      END_CELL_EDIT: 'uiGridEventEndCellEdit',
      CANCEL_CELL_EDIT: 'uiGridEventCancelCellEdit'
    }
  });

  /**
   *  @ngdoc service
   *  @name ui.grid.edit.service:uiGridEditService
   *
   *  @description Services for editing features
   */
  module.service('uiGridEditService', ['$log', '$q', '$templateCache',
    function ($log, $q, $templateCache) {

      var service = {
        /**
         * @ngdoc service
         * @name editColumnBuilder
         * @methodOf ui.grid.edit.service:uiGridEditService
         * @description columnBuilder function that adds edit properties to grid column
         * @returns {promise} promise that will load any needed templates when resolved
         */
        editColumnBuilder: function (colDef, col, gridOptions) {

          var promises = [];

          col.enableCellEdit = colDef.enableCellEdit !== undefined ?
            colDef.enableCellEdit : gridOptions.enableCellEdit;

          col.cellEditableCondition = colDef.cellEditableCondition || gridOptions.cellEditableCondition || 'true';

          if (col.enableCellEdit) {
            col.editableCellTemplate = colDef.editableCellTemplate || $templateCache.get('ui-grid/edit/editableCell');
            col.editableCellDirective = colDef.editableCellDirective || 'ui-grid-text-editor';
          }

          //enableCellEditOnFocus can only be used if cellnav module is used
          col.enableCellEditOnFocus = colDef.enableCellEditOnFocus !== undefined ?
            colDef.enableCellEditOnFocus : gridOptions.enableCellEditOnFocus;

          return $q.all(promises);
        }
      };

      return service;

    }]);

  /**
   *  @ngdoc directive
   *  @name ui.grid.edit.directive:uiGridEdit
   *  @element div
   *  @restrict EA
   *
   *  @description Adds editing features to the ui-grid directive.
   *
   *  @example
   <example module="app">
   <file name="app.js">
   var app = angular.module('app', ['ui.grid', 'ui.grid.edit']);

   app.controller('MainCtrl', ['$scope', function ($scope) {
      $scope.data = [
        { name: 'Bob', title: 'CEO' },
            { name: 'Frank', title: 'Lowly Developer' }
      ];

      $scope.columnDefs = [
        {name: 'name', enableCellEdit: true},
        {name: 'title', enableCellEdit: true}
      ];
    }]);
   </file>
   <file name="index.html">
   <div ng-controller="MainCtrl">
   <div ui-grid="{ data: data, columnDefs: columnDefs }" ui-grid-edit></div>
   </div>
   </file>
   </example>
   */
  module.directive('uiGridEdit', ['$log', 'uiGridEditService', function ($log, uiGridEditService) {
    return {
      replace: true,
      priority: 0,
      require: '^uiGrid',
      scope: false,
      compile: function () {
        return {
          pre: function ($scope, $elm, $attrs, uiGridCtrl) {
            uiGridCtrl.grid.registerColumnBuilder(uiGridEditService.editColumnBuilder);
          },
          post: function ($scope, $elm, $attrs, uiGridCtrl) {
          }
        };
      }
    };
  }]);

  /**
   *  @ngdoc directive
   *  @name ui.grid.edit.directive:uiGridCell
   *  @element div
   *  @restrict A
   *
   *  @description Stacks on top of ui.grid.uiGridCell to provide in-line editing capabilities to the cell
   *  Editing Actions.
   *
   *  Binds edit start events to the uiGridCell element.  When the events fire, the gridCell element is replaced
   *  with the columnDef.editableCellDirective directive ('ui-grid-text-editor' by default).
   *
   *  The editableCellDirective should respond to uiGridEditConstants.events.BEGIN\_CELL\_EDIT angular event
   *  and do the initial steps needed to edit the cell (setfocus on input element, etc).
   *
   *  When the editableCellDirective recognizes that the editing is ended (blur event, Enter key, etc.)
   *  it should emit the uiGridEditConstants.events.END\_CELL\_EDIT event.
   *
   *  If editableCellDirective recognizes that the editing has been cancelled (esc key)
   *  it should emit the uiGridEditConstants.events.CANCEL\_CELL\_EDIT event.  The original value
   *  will be set back on the model by the uiGridCell directive.
   *
   *  Events that invoke editing:
   *    - dblclick
   *    - F2 keydown (when using cell selection)
   *
   *  Events that end editing:
   *    - Dependent on the specific editableCellDirective
   *    - Standards should be blur and enter keydown
   *
   *  Events that cancel editing:
   *    - Dependent on the specific editableCellDirective
   *    - Standards should be Esc keydown
   *
   *  Grid Events that end editing:
   *    - uiGridConstants.events.GRID_SCROLL
   *
   */
  module.directive('uiGridCell', ['$compile', 'uiGridConstants', 'uiGridEditConstants', '$log', '$parse',
    function ($compile, uiGridConstants, uiGridEditConstants, $log, $parse) {
      return {
        priority: -100, // run after default uiGridCell directive
        restrict: 'A',
        scope: false,
        link: function ($scope, $elm, $attrs) {
          if (!$scope.col.colDef.enableCellEdit) {
            return;
          }

          var html;
          var origCellValue;
          var inEdit = false;
          var cellModel;

          registerBeginEditEvents();

          function registerBeginEditEvents() {
            $elm.on('dblclick', function () {
              beginEdit();
            });
            $elm.on('keydown', function (evt) {
              switch (evt.keyCode) {
                case uiGridConstants.keymap.F2:
                  evt.stopPropagation();
                  beginEdit();
                  break;
              }
            });
            if ($scope.col.enableCellEditOnFocus) {
              $elm.find('div').on('focus', function (evt) {
                evt.stopPropagation();
                beginEdit();
              });
            }
          }

          function cancelBeginEditEvents() {
            $elm.off('dblclick');
            $elm.off('keydown');
            if ($scope.col.enableCellEditOnFocus) {
              $elm.find('div').off('focus');
            }
          }

          function beginEdit() {
            cellModel = $parse($scope.row.getQualifiedColField($scope.col));
            //get original value from the cell
            origCellValue = cellModel($scope);

            html = $scope.col.editableCellTemplate;
            html = html.replace(uiGridEditConstants.EDITABLE_CELL_DIRECTIVE, $scope.col.editableCellDirective);

            var cellElement;
            $scope.$apply(function () {
                inEdit = true;
                cancelBeginEditEvents();
                cellElement = $compile(html)($scope.$new());
                angular.element($elm.children()[0]).addClass('ui-grid-cell-contents-hidden');
                $elm.append(cellElement);
              }
            );

            //stop editing when grid is scrolled
            var deregOnGridScroll = $scope.$on(uiGridConstants.events.GRID_SCROLL, function () {
              endEdit();
              deregOnGridScroll();
            });

            //end editing
            var deregOnEndCellEdit = $scope.$on(uiGridEditConstants.events.END_CELL_EDIT, function () {
              endEdit();
              deregOnEndCellEdit();
            });

            //cancel editing
            var deregOnCancelCellEdit = $scope.$on(uiGridEditConstants.events.CANCEL_CELL_EDIT, function () {
              cancelEdit();
              deregOnCancelCellEdit();
            });

            $scope.$broadcast(uiGridEditConstants.events.BEGIN_CELL_EDIT);
          }

          function endEdit() {
            if (!inEdit) {
              return;
            }
            angular.element($elm.children()[1]).remove();
            angular.element($elm.children()[0]).removeClass('ui-grid-cell-contents-hidden');
            inEdit = false;
            registerBeginEditEvents();
          }

          function cancelEdit() {
            if (!inEdit) {
              return;
            }
            cellModel.assign($scope, origCellValue);
            $scope.$apply();

            endEdit();
          }

        }
      };
    }]);

  /**
   *  @ngdoc directive
   *  @name ui.grid.edit.directive:uiGridTextEditor
   *  @element div
   *  @restrict A
   *
   *  @description input editor component for text fields.  Can be used as a template to develop other editors
   *
   *  Events that end editing:
   *     blur and enter keydown
   *
   *  Events that cancel editing:
   *    - Esc keydown
   *
   */
  module.directive('uiGridTextEditor',
    ['uiGridConstants', 'uiGridEditConstants', '$log', '$templateCache', '$compile',
      function (uiGridConstants, uiGridEditConstants, $log, $templateCache, $compile) {
        return{
          scope: true,
          compile: function () {
            return {
              pre: function ($scope, $elm, $attrs) {

              },
              post: function ($scope, $elm, $attrs) {

                var html = $templateCache.get('ui-grid/edit/cellTextEditor');
                html = html.replace(uiGridConstants.COL_FIELD, $scope.row.getQualifiedColField($scope.col));
                var cellElement = $compile(html)($scope);
                $elm.append(cellElement);

                var inputElm = $elm.find('input');

                //set focus at start of edit
                $scope.$on(uiGridEditConstants.events.BEGIN_CELL_EDIT, function () {
                  inputElm[0].focus();
                  inputElm.on('blur', function (evt) {
                    $scope.stopEdit();
                  });
                });

                $scope.stopEdit = function () {
                  $scope.$emit(uiGridEditConstants.events.END_CELL_EDIT);
                };

                $elm.on('keydown', function (evt) {
                  switch (evt.keyCode) {
                    case uiGridConstants.keymap.ESC:
                      evt.stopPropagation();
                      $scope.$emit(uiGridEditConstants.events.CANCEL_CELL_EDIT);
                      break;
                    case uiGridConstants.keymap.ENTER: // Enter (Leave Field)
                      evt.stopPropagation();
                      $scope.stopEdit();
                      break;
                  }

                  return true;
                });
              }
            };
          }
        };
      }]);

})();